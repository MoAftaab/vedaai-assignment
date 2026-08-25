import "server-only";
import type {
  AssessmentResult,
  BBox,
  PageImage,
  ProcessRequest,
  Provider,
  Question,
  Region,
  UnmatchedAnswer,
} from "@/lib/types";
import { normalizeLabel } from "@/lib/format";
import { getLLM } from "./llm/client";
import {
  ANSWER_EXTRACTION_SYSTEM,
  answerUserText,
  GRADING_SYSTEM,
  MAPPING_SYSTEM,
  QUESTION_EXTRACTION_SYSTEM,
  questionUserText,
} from "./prompts";

interface RawQuestion {
  label: string;
  text: string;
  maxScore: number | null;
}
interface RawBlock {
  label: string | null;
  transcript: string;
  bbox: unknown;
}
type PagedBlock = { label: string | null; transcript: string; bbox: unknown; page: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Bounded-concurrency map. */
async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function sanitizeBbox(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map((v) => Number(v));
  if (nums.some((v) => !Number.isFinite(v))) return null;
  let [x, y, w, h] = nums;
  x = clamp01(x);
  y = clamp01(y);
  w = clamp(w, 0.01, 1 - x);
  h = clamp(h, 0.01, 1 - y);
  return [x, y, w, h];
}

function attachRegion(q: Question, region: Region, transcript: string) {
  if (!q.answer) q.answer = { transcript: "", regions: [] };
  q.answer.regions.push(region);
  const t = (transcript || "").trim();
  if (t) q.answer.transcript = q.answer.transcript ? `${q.answer.transcript}\n${t}` : t;
  q.status = "answered";
}

function pickProvider(used: Set<Provider>): Provider {
  if (used.has("agentrouter")) return "agentrouter";
  if (used.has("openai")) return "openai";
  return "deterministic";
}

export async function runPipeline(req: ProcessRequest): Promise<AssessmentResult> {
  const llm = getLLM();
  const used = new Set<Provider>();
  const qPages: PageImage[] = req.questionPages ?? [];
  const aPages: PageImage[] = req.answerPages ?? [];

  // ── 1. Extract questions (per page, in parallel) ───────────────
  const perPageQuestions = await pMap(qPages, 4, async (pg, i) => {
    try {
      const { data, provider } = await llm.visionJson<{ questions: RawQuestion[] }>(
        pg.base64,
        QUESTION_EXTRACTION_SYSTEM,
        questionUserText(i, qPages.length),
        { mime: pg.mime, maxTokens: 4096 },
      );
      used.add(provider);
      return data?.questions ?? [];
    } catch {
      return [];
    }
  });

  const questions: Question[] = [];
  const byLabel = new Map<string, Question>();
  for (const list of perPageQuestions) {
    for (const rq of list) {
      const norm = normalizeLabel(rq.label);
      if (!norm.label) continue;
      const existing = byLabel.get(norm.label);
      if (existing) {
        if (rq.text && !existing.text.includes(rq.text)) {
          existing.text = `${existing.text} ${rq.text}`.trim();
        }
        continue;
      }
      const q: Question = {
        id: `q-${norm.label}`,
        label: norm.label,
        displayNumber: norm.displayNumber,
        part: norm.part,
        text: (rq.text || "").trim(),
        maxScore: typeof rq.maxScore === "number" && rq.maxScore > 0 ? rq.maxScore : 0,
        status: "unanswered",
      };
      byLabel.set(norm.label, q);
      questions.push(q);
    }
  }

  // ── 2. Extract handwritten answers + bboxes (per page) ─────────
  const perPageBlocks = await pMap(aPages, 4, async (pg, i) => {
    try {
      const { data, provider } = await llm.visionJson<{ blocks: RawBlock[] }>(
        pg.base64,
        ANSWER_EXTRACTION_SYSTEM,
        answerUserText(i, aPages.length),
        { mime: pg.mime, maxTokens: 4096 },
      );
      used.add(provider);
      return (data?.blocks ?? []).map<PagedBlock>((b) => ({ ...b, page: i }));
    } catch {
      return [] as PagedBlock[];
    }
  });
  const blocks: PagedBlock[] = perPageBlocks.flat();
  const consumed = new Array<boolean>(blocks.length).fill(false);

  // ── 3a. Map blocks that carry an explicit label ────────────────
  blocks.forEach((b, idx) => {
    if (b.label == null) return;
    const q = byLabel.get(normalizeLabel(String(b.label)).label);
    const bbox = sanitizeBbox(b.bbox);
    if (q && bbox) {
      attachRegion(q, { page: b.page, bbox }, b.transcript);
      consumed[idx] = true;
    }
  });

  // ── 3b. Fuzzy-map unlabeled blocks to still-unanswered questions ─
  const unlabeled = blocks
    .map((b, idx) => ({ b, idx }))
    .filter(({ b, idx }) => !consumed[idx] && b.label == null);
  const stillUnanswered = questions.filter((q) => q.status === "unanswered");
  if (unlabeled.length && stillUnanswered.length) {
    try {
      const mapInput = {
        questions: stillUnanswered.map((q) => ({ label: q.label, text: q.text })),
        blocks: unlabeled.map(({ b }, i) => ({
          id: `b${i}`,
          transcript: (b.transcript || "").slice(0, 600),
        })),
      };
      const { data, provider } = await llm.generateJson<{
        assignments: { id: string; label: string | null }[];
      }>(MAPPING_SYSTEM, JSON.stringify(mapInput), { maxTokens: 1024 });
      used.add(provider);
      const takenLabels = new Set<string>();
      for (const a of data?.assignments ?? []) {
        if (!a.label) continue;
        const m = a.id.match(/^b(\d+)$/);
        if (!m) continue;
        const entry = unlabeled[Number(m[1])];
        if (!entry) continue;
        const q = byLabel.get(normalizeLabel(a.label).label);
        const bbox = sanitizeBbox(entry.b.bbox);
        if (q && bbox && q.status === "unanswered" && !takenLabels.has(q.label)) {
          attachRegion(q, { page: entry.b.page, bbox }, entry.b.transcript);
          consumed[entry.idx] = true;
          takenLabels.add(q.label);
        }
      }
    } catch {
      /* mapping is best-effort */
    }
  }

  // ── 3c. Anything still unconsumed becomes an unmatched answer ───
  const unmatched: UnmatchedAnswer[] = [];
  blocks.forEach((b, idx) => {
    if (consumed[idx]) return;
    const bbox = sanitizeBbox(b.bbox);
    if (!bbox) return;
    unmatched.push({
      label: b.label != null ? normalizeLabel(String(b.label)).label : undefined,
      transcript: (b.transcript || "").trim(),
      regions: [{ page: b.page, bbox }],
    });
  });

  // ── 4. Grade + feedback (one batched call) ─────────────────────
  let overall = "";
  try {
    const gradeInput = {
      questions: questions.map((q) => ({
        label: q.label,
        text: q.text,
        maxScore: q.maxScore > 0 ? q.maxScore : null,
        answer: q.answer?.transcript?.trim() || "[NO ANSWER]",
      })),
    };
    const { data, provider } = await llm.generateJson<{
      grades: { label: string; maxScore: number; score: number; feedback: string }[];
      overall: string;
    }>(GRADING_SYSTEM, JSON.stringify(gradeInput), { maxTokens: 6000 });
    used.add(provider);
    overall = data?.overall ?? "";
    const grades = new Map(
      (data?.grades ?? []).map((g) => [normalizeLabel(g.label).label, g]),
    );
    for (const q of questions) {
      const g = grades.get(q.label);
      const inferredMax = g?.maxScore && g.maxScore > 0 ? g.maxScore : q.maxScore > 0 ? q.maxScore : 5;
      q.maxScore = q.maxScore > 0 ? q.maxScore : inferredMax;
      if (q.status === "unanswered") {
        q.score = 0;
        q.feedback = g?.feedback || "No answer was attempted for this question.";
      } else {
        q.score = g ? clamp(Math.round(g.score * 2) / 2, 0, q.maxScore) : 0;
        q.feedback = g?.feedback || "";
      }
    }
  } catch {
    for (const q of questions) {
      if (q.maxScore <= 0) q.maxScore = 5;
      q.score = q.status === "answered" ? Math.round(q.maxScore * 0.6) : 0;
      q.feedback =
        q.status === "answered"
          ? "Answer recorded (automatic grading was unavailable)."
          : "No answer was attempted for this question.";
    }
  }

  const maxScore = questions.reduce((s, q) => s + (q.maxScore || 0), 0);
  const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0);
  const answeredCount = questions.filter((q) => q.status === "answered").length;

  return {
    questions,
    unmatched,
    answerPages: aPages.map((p) => ({ w: p.w, h: p.h })),
    summary: {
      totalQuestions: questions.length,
      answeredCount,
      totalScore,
      maxScore,
      overall,
    },
    provider: pickProvider(used),
  };
}
