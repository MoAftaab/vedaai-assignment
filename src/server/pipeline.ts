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
  confidence?: number;
}
interface RawBlock {
  label: string | null;
  transcript: string;
  bbox: unknown;
  confidence?: number;
}
type PagedBlock = { label: string | null; transcript: string; bbox: unknown; confidence?: number; page: number };

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

function sanitizeBbox(raw: unknown, pageMeta?: { w?: number; h?: number }): BBox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  let nums = raw.slice(0, 4).map((v) => Number(v));
  if (nums.some((v) => !Number.isFinite(v))) return null;

  // Detect scale: if any value > 1.0, normalize it
  if (nums.some((v) => v > 1)) {
    const scaleX = pageMeta?.w && pageMeta.w > 100 ? pageMeta.w : 1000;
    const scaleY = pageMeta?.h && pageMeta.h > 100 ? pageMeta.h : 1000;

    const [a, b, c, d] = nums;
    // Check if format is [x1, y1, x2, y2] where c > a and d > b
    if (c > a && d > b && c > 1 && d > 1 && c > scaleX * 0.4) {
      const x = a / scaleX;
      const y = b / scaleY;
      const w = (c - a) / scaleX;
      const h = (d - b) / scaleY;
      nums = [x, y, w, h];
    } else {
      nums = [a / scaleX, b / scaleY, c / scaleX, d / scaleY];
    }
  }

  let [x, y, w, h] = nums;
  x = clamp01(x);
  y = clamp01(y);
  w = clamp(w, 0.01, 1 - x);
  h = clamp(h, 0.01, 1 - y);
  return [x, y, w, h];
}

function attachRegion(q: Question, region: Region, transcript: string, confidence?: number) {
  if (!q.answer) q.answer = { transcript: "", regions: [] };
  q.answer.regions.push(region);
  const t = (transcript || "").trim();
  if (t) q.answer.transcript = q.answer.transcript ? `${q.answer.transcript}\n${t}` : t;
  q.status = "answered";
  if (confidence != null && Number.isFinite(confidence)) {
    q.confidence = q.confidence == null ? confidence : Math.min(q.confidence, confidence);
    q.answer.confidence = q.confidence;
  }
}

function pickProvider(used: Set<Provider>): Provider {
  if (used.has("gemini")) return "gemini";
  return "deterministic";
}

export async function runPipeline(req: ProcessRequest): Promise<AssessmentResult> {
  const llm = getLLM();
  const used = new Set<Provider>();
  const qPages: PageImage[] = req.questionPages ?? [];
  const aPages: PageImage[] = req.answerPages ?? [];
  // Remembered so a total Gemini outage produces an actionable message
  // instead of an empty (but "successful") result.
  let lastError: string | null = null;

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
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] question page ${i} failed:`, lastError);
      return [];
    }
  });

  // Fail fast: if Gemini did not answer a single vision call, the AI is
  // unreachable from this server — surface that instead of spending another
  // 90s per answer page to arrive at an empty screen.
  if (qPages.length > 0 && !used.has("gemini")) {
    throw new Error(
      `Gemini is unreachable from the server. No Gemini request completed. Last error: ${lastError ?? "unknown"}`,
    );
  }

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
        confidence: typeof rq.confidence === "number" ? clamp01(rq.confidence) : undefined,
      };
      byLabel.set(norm.label, q);
      questions.push(q);
    }
  }

  // No questions at all means there is nothing to display — never render an
  // empty result as a success.
  if (questions.length === 0) {
    throw new Error(
      lastError
        ? `No questions could be extracted from the question paper. Last error: ${lastError}`
        : "No questions could be extracted from the question paper. Try a clearer scan or a higher-resolution page.",
    );
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
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] answer page ${i} failed:`, lastError);
      return [] as PagedBlock[];
    }
  });
  const blocks: PagedBlock[] = perPageBlocks.flat();
  const consumed = new Array<boolean>(blocks.length).fill(false);

  // ── 3. Cross-check every block before mapping ──────────────────
  // The vision model can misread a handwritten marker (e.g. "Ans 4" as "2").
  // Send labeled blocks through the semantic matcher too; the marker is evidence,
  // not an unconditional mapping instruction.
  const candidates = blocks.map((b, idx) => ({ b, idx }));
  const candidateQuestions = questions;
  if (candidates.length && candidateQuestions.length) {
    try {
      const mapInput = {
        questions: candidateQuestions.map((q) => ({ label: q.label, text: q.text, alreadyAnswered: q.status === "answered" })),
        blocks: candidates.map(({ b }, i) => ({
          id: `b${i}`,
          observedLabel: b.label,
          transcript: (b.transcript || "").slice(0, 600),
        })),
      };
      const { data, provider } = await llm.generateJson<{
        assignments: { id: string; label: string | null; continuation?: boolean; confidence?: number }[];
      }>(MAPPING_SYSTEM, JSON.stringify(mapInput), { maxTokens: 1024 });
      used.add(provider);
      const takenLabels = new Set<string>();
      for (const a of data?.assignments ?? []) {
        if (!a.label) continue;
        const m = a.id.match(/^b(\d+)$/);
        if (!m) continue;
        const entry = candidates[Number(m[1])];
        if (!entry) continue;
        const q = byLabel.get(normalizeLabel(a.label).label);
        const bbox = sanitizeBbox(entry.b.bbox, aPages[entry.b.page]);
        const isContinuation = a.continuation === true && q?.status === "answered";
        if (q && bbox && (q.status === "unanswered" || isContinuation) && (isContinuation || !takenLabels.has(q.label))) {
          attachRegion(q, { page: entry.b.page, bbox }, entry.b.transcript, typeof a.confidence === "number" ? clamp01(a.confidence) : undefined);
          consumed[entry.idx] = true;
          takenLabels.add(q.label);
        }
      }
    } catch {
      // If the semantic cross-check is unavailable, use an exact observed label
      // as a conservative fallback. Unlabeled blocks stay unmatched.
      candidates.forEach(({ b, idx }) => {
        if (consumed[idx] || b.label == null) return;
        const q = byLabel.get(normalizeLabel(String(b.label)).label);
        const bbox = sanitizeBbox(b.bbox, aPages[b.page]);
        if (q && bbox && q.status === "unanswered") {
          attachRegion(q, { page: b.page, bbox }, b.transcript, typeof b.confidence === "number" ? clamp01(b.confidence) : undefined);
          consumed[idx] = true;
        }
      });
    }
  }

  // ── 3c. Anything still unconsumed becomes an unmatched answer ───
  const unmatched: UnmatchedAnswer[] = [];
  blocks.forEach((b, idx) => {
    if (consumed[idx]) return;
    const bbox = sanitizeBbox(b.bbox, aPages[b.page]);
    if (!bbox) return;
    unmatched.push({
      label: b.label != null ? normalizeLabel(String(b.label)).label : undefined,
      transcript: (b.transcript || "").trim(),
      regions: [{ page: b.page, bbox }],
      confidence: typeof b.confidence === "number" ? clamp01(b.confidence) : undefined,
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
        regions: q.answer?.regions ?? [],
      })),
    };
    const { data, provider } = await llm.visionJsonMulti<{
      grades: { label: string; maxScore: number; score: number; feedback: string }[];
      overall: string;
    }>(
      aPages.map((page) => ({ base64: page.base64, mime: page.mime })),
      GRADING_SYSTEM,
      JSON.stringify(gradeInput),
      { maxTokens: 6000 },
    );
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
      q.score = q.status === "unanswered" ? 0 : undefined;
      q.feedback = q.status === "answered"
        ? "Answer recorded, but Gemini grading was unavailable. Review manually before assigning marks."
        : "No answer was attempted for this question.";
    }
  }

  const maxScore = questions.reduce((s, q) => s + (q.maxScore || 0), 0);
  const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0);
  const answeredCount = questions.filter((q) => q.status === "answered").length;
  const ungradedCount = questions.filter((q) => q.status === "answered" && q.score == null).length;

  return {
    questions,
    unmatched,
    answerPages: aPages.map((p) => ({ w: p.w, h: p.h })),
    summary: {
      totalQuestions: questions.length,
      answeredCount,
      totalScore,
      maxScore,
      ungradedCount,
      overall,
    },
    provider: pickProvider(used),
  };
}
