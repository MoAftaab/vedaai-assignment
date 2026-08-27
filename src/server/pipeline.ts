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
  ANSWER_RESPONSE_SCHEMA,
  FINAL_ASSESSMENT_RESPONSE_SCHEMA,
  QUESTION_RESPONSE_SCHEMA,
} from "./schemas";
import {
  ANSWER_EXTRACTION_SYSTEM,
  answerUserText,
  FINAL_ASSESSMENT_SYSTEM,
  QUESTION_EXTRACTION_SYSTEM,
  questionBatchUserText,
} from "./prompts";

interface RawQuestion {
  page: number;
  label: string;
  text: string;
  maxScore: number | null;
  confidence?: number;
}
interface RawBlock {
  page: number;
  label: string | null;
  transcript: string;
  visualDescription?: string;
  bbox: unknown;
  confidence?: number;
  labelConfidence?: number;
}
type PagedBlock = { label: string | null; transcript: string; visualDescription?: string; bbox: unknown; confidence?: number; labelConfidence?: number; page: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Bounded-concurrency map for independent page extraction calls. */
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

  // New contract: Gemini's documented [ymin, xmin, ymax, xmax] box in 0..1000.
  // Keep support for old saved results that used [x, y, width, height] in 0..1.
  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (nums.every((value) => value >= 0 && value <= 1)) {
    [x, y, w, h] = nums;
  } else {
    const [ymin, xmin, ymax, xmax] = nums;
    if (ymax <= ymin || xmax <= xmin || nums.some((value) => value < 0 || value > 1000)) return null;
    x = xmin / 1000;
    y = ymin / 1000;
    w = (xmax - xmin) / 1000;
    h = (ymax - ymin) / 1000;
  }
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  x = clamp01(x);
  y = clamp01(y);
  w = clamp(w, 0.01, 1 - x);
  h = clamp(h, 0.01, 1 - y);
  return [x, y, w, h];
}

function attachRegion(q: Question, region: Region, transcript: string, confidence?: number, visualDescription?: string) {
  if (!q.answer) q.answer = { transcript: "", regions: [] };
  q.answer.regions.push(region);
  const t = (transcript || "").trim();
  if (t) q.answer.transcript = q.answer.transcript ? `${q.answer.transcript}\n${t}` : t;
  const visual = (visualDescription || "").trim();
  if (visual && visual.toLowerCase() !== "none") {
    q.answer.visualDescription = q.answer.visualDescription
      ? `${q.answer.visualDescription}; ${visual}`
      : visual;
  }
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

  // ── 1. Extract questions (one multimodal batch) ─────────────────
  // Keeping all question pages in the same context helps Gemini preserve
  // numbering and sub-parts that wrap across a page boundary.
  const perPageQuestions: RawQuestion[][] = Array.from({ length: qPages.length }, () => []);
  try {
    const { data, provider } = await llm.visionJsonMulti<{ questions: RawQuestion[] }>(
      qPages.map((page) => ({ base64: page.base64, mime: page.mime })),
      QUESTION_EXTRACTION_SYSTEM,
      questionBatchUserText(qPages.length),
      { maxTokens: 6000, responseSchema: QUESTION_RESPONSE_SCHEMA },
    );
    used.add(provider);
    for (const question of data?.questions ?? []) {
      const page = Number(question.page);
      if (Number.isInteger(page) && page >= 0 && page < qPages.length) perPageQuestions[page].push(question);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error("[pipeline] question extraction failed:", lastError);
  }

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

  // ── 2. Extract handwritten answers + bboxes (per physical page) ─
  // Page-scoped extraction preserves separate regions for answers that continue
  // onto another page. The final multimodal call below reconnects those blocks.
  let answerPageFailures = 0;
  const perPageBlocks = await pMap(aPages, 4, async (pg, i) => {
    try {
      const { data, provider } = await llm.visionJson<{ blocks: RawBlock[] }>(
        pg.base64,
        ANSWER_EXTRACTION_SYSTEM,
        answerUserText(i, aPages.length, questions.map((q) => ({ label: q.label, text: q.text }))),
        { mime: pg.mime, maxTokens: 4096, responseSchema: ANSWER_RESPONSE_SCHEMA },
      );
      used.add(provider);
      return (data?.blocks ?? []).map<PagedBlock>((block) => ({ ...block, page: i }));
    } catch (err) {
      answerPageFailures += 1;
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] answer page ${i} failed:`, lastError);
      return [] as PagedBlock[];
    }
  });
  if (aPages.length > 0 && answerPageFailures === aPages.length) {
    throw new Error(
      `Gemini could not read any answer-sheet pages. Last error: ${lastError ?? "unknown"}`,
    );
  }
  const blocks: PagedBlock[] = perPageBlocks.flat();
  const consumed = new Array<boolean>(blocks.length).fill(false);

  // ── 3. Final multimodal reconciliation + grading ─────────────────
  // One final call sees the original pages and all extracted blocks at once.
  // It first assigns blocks, then grades those assignments, preventing mapping
  // and grading from using different or stale interpretations of the image.
  const candidates = blocks.map((b, idx) => ({ b, idx }));
  const candidateQuestions = questions;
  let finalSucceeded = false;
  let overall = "";
  let grades = new Map<string, { maxScore: number; score: number; feedback: string }>();
  if (candidateQuestions.length) {
    try {
      const finalInput = {
        questions: candidateQuestions.map((q) => ({ label: q.label, text: q.text, maxScore: q.maxScore || 0 })),
        blocks: candidates.map(({ b }, i) => ({
          id: `b${i}`,
          page: b.page,
          observedLabel: b.label || "",
          transcript: (b.transcript || "").slice(0, 600),
          visualDescription: b.visualDescription || "none",
          bbox: b.bbox,
        })),
      };
      const { data, provider } = await llm.visionJsonMulti<{
        assignments: { id: string; label: string; continuation: boolean; confidence: number }[];
        grades: { label: string; maxScore: number; score: number; feedback: string }[];
        overall: string;
      }>(
        aPages.map((page) => ({ base64: page.base64, mime: page.mime })),
        FINAL_ASSESSMENT_SYSTEM,
        JSON.stringify(finalInput),
        { maxTokens: 6000, responseSchema: FINAL_ASSESSMENT_RESPONSE_SCHEMA },
      );
      used.add(provider);

      // A block can appear in only one target group. Keep its highest-confidence
      // valid assignment before resolving each question's primary/continuations.
      const bestByBlock = new Map<string, (typeof data.assignments)[number]>();
      for (const assignment of data?.assignments ?? []) {
        const confidence = Number(assignment.confidence);
        const blockIndex = Number(assignment.id?.slice(1));
        const label = typeof assignment.label === "string" ? normalizeLabel(assignment.label).label : "";
        if (!assignment.id?.match(/^b\d+$/) || !Number.isInteger(blockIndex) || !candidates[blockIndex] || !label || !byLabel.has(label) || !Number.isFinite(confidence) || confidence < 0.55) continue;
        const existing = bestByBlock.get(assignment.id);
        if (!existing || Number(existing.confidence) < confidence) bestByBlock.set(assignment.id, assignment);
      }
      const byTarget = new Map<string, (typeof data.assignments)[number][]>();
      for (const assignment of bestByBlock.values()) {
        const label = normalizeLabel(assignment.label).label;
        const existing = byTarget.get(label) ?? [];
        existing.push(assignment);
        byTarget.set(label, existing);
      }
      for (const [label, targetAssignments] of byTarget) {
        const q = byLabel.get(label);
        if (!q) continue;
        const ordered = [...targetAssignments].sort((a, b) => Number(b.confidence) - Number(a.confidence));
        const primary = ordered.find((assignment) => !assignment.continuation) ?? ordered[0];
        const primaryEntry = primary && candidates[Number(primary.id.slice(1))];
        const primaryBbox = primaryEntry ? sanitizeBbox(primaryEntry.b.bbox) : null;
        if (!primary || !primaryEntry || !primaryBbox) continue;
        attachRegion(q, { page: primaryEntry.b.page, bbox: primaryBbox }, primaryEntry.b.transcript, Math.min(clamp01(Number(primary.confidence)), clamp01(Number(primaryEntry.b.confidence ?? 1))), primaryEntry.b.visualDescription);
        consumed[primaryEntry.idx] = true;
        for (const continuation of ordered.filter((assignment) => assignment !== primary && assignment.continuation)) {
          const entry = candidates[Number(continuation.id.slice(1))];
          const bbox = entry ? sanitizeBbox(entry.b.bbox) : null;
          if (!entry || !bbox || consumed[entry.idx]) continue;
          attachRegion(q, { page: entry.b.page, bbox }, entry.b.transcript, Math.min(clamp01(Number(continuation.confidence)), clamp01(Number(entry.b.confidence ?? 1))), entry.b.visualDescription);
          consumed[entry.idx] = true;
        }
      }
      grades = new Map((data?.grades ?? []).map((grade) => [normalizeLabel(grade.label).label, grade]));
      overall = data?.overall ?? "";
      finalSucceeded = true;
    } catch (err) {
      // Never trust a possibly misread handwritten label when the image-grounded
      // reconciliation is unavailable. Keeping it unmatched is safer than grading
      // the wrong question and showing a misleading highlight.
      console.error("[pipeline] final multimodal assessment failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── 3c. Anything still unconsumed becomes an unmatched answer ───
  const unmatched: UnmatchedAnswer[] = [];
  blocks.forEach((b, idx) => {
    if (consumed[idx]) return;
    unmatched.push({
      label: b.label != null ? normalizeLabel(String(b.label)).label : undefined,
      transcript: (b.transcript || "").trim(),
      visualDescription: b.visualDescription,
      regions: (() => {
        const bbox = sanitizeBbox(b.bbox);
        return bbox ? [{ page: b.page, bbox }] : [];
      })(),
      confidence: typeof b.confidence === "number" ? clamp01(b.confidence) : undefined,
    });
  });

  // ── 4. Apply grades returned with the reconciled assignments ─────
  if (finalSucceeded) {
    for (const q of questions) {
      const g = grades.get(q.label);
      const inferredMax = g?.maxScore && g.maxScore > 0 ? g.maxScore : q.maxScore > 0 ? q.maxScore : 5;
      q.maxScore = q.maxScore > 0 ? q.maxScore : inferredMax;
      if (q.status === "unanswered") {
        q.score = 0;
        q.feedback = g?.feedback || "No answer was attempted for this question.";
      } else {
        const rawScore = Number(g?.score);
        q.score = Number.isFinite(rawScore) ? clamp(Math.round(rawScore * 2) / 2, 0, q.maxScore) : undefined;
        q.feedback = g?.feedback || "Answer recorded, but Gemini did not return a grade. Review manually before assigning marks.";
      }
    }
  } else {
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
