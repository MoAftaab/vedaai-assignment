import "server-only";
import type { AssessmentResult, BBox, PageImage, ProcessRequest, Provider, Question, Region, UnmatchedAnswer } from "@/lib/types";
import { normalizeLabel } from "@/lib/format";
import { getLLM } from "./llm/client";
import { ANSWER_RESPONSE_SCHEMA, FINAL_ASSESSMENT_RESPONSE_SCHEMA, QUESTION_RESPONSE_SCHEMA } from "./schemas";
import { ANSWER_EXTRACTION_SYSTEM, answerUserText, FINAL_ASSESSMENT_SYSTEM, questionBatchUserText, QUESTION_EXTRACTION_SYSTEM } from "./prompts";

interface RawQuestion { page: number; label: string; text: string; maxScore: number; confidence: number }
interface RawRegion { page: number; bbox: unknown }
interface RawBlock { page: number; label: string; transcript: string; visualDescription: string; regions: RawRegion[]; confidence: number; labelConfidence: number }
interface RawAssignment { id: string; label: string; continuation: boolean; confidence: number }
interface RawGrade { label: string; maxScore: number; score: number; feedback: string }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

function confidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? clamp01(number) : 0;
}

/** Convert Gemini's documented [ymin, xmin, ymax, xmax] / 0..1000 box. */
function sanitizeBbox(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const values = raw.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) return null;
  const [ymin, xmin, ymax, xmax] = values;
  if (ymax <= ymin || xmax <= xmin) return null;
  const x = clamp01(xmin / 1000);
  const y = clamp01(ymin / 1000);
  return [x, y, clamp((xmax - xmin) / 1000, 0.01, 1 - x), clamp((ymax - ymin) / 1000, 0.01, 1 - y)];
}

function regionsFor(block: RawBlock, pageCount: number): Array<{ page: number; bbox: BBox }> {
  if (!Array.isArray(block.regions)) return [];
  return block.regions.flatMap((region) => {
    const page = Number(region?.page);
    const bbox = sanitizeBbox(region?.bbox);
    return Number.isInteger(page) && page >= 0 && page < pageCount && bbox ? [{ page, bbox }] : [];
  });
}

function firstRegionTop(block: RawBlock, pageCount: number): number {
  return regionsFor(block, pageCount)[0]?.bbox[1] ?? Number.POSITIVE_INFINITY;
}

function attachRegion(question: Question, region: Region, transcript: string, visualDescription: string, matchConfidence: number) {
  if (!question.answer) question.answer = { transcript: "", regions: [] };
  question.answer.regions.push(region);
  const text = transcript.trim();
  if (text) question.answer.transcript = question.answer.transcript ? `${question.answer.transcript}\n${text}` : text;
  const visual = visualDescription.trim();
  if (visual && visual.toLowerCase() !== "none") question.answer.visualDescription = question.answer.visualDescription ? `${question.answer.visualDescription}; ${visual}` : visual;
  question.status = "answered";
  question.confidence = question.confidence == null ? matchConfidence : Math.min(question.confidence, matchConfidence);
  question.answer.confidence = question.confidence;
}

function buildQuestions(rawQuestions: RawQuestion[]): Question[] {
  const result: Question[] = [];
  const byLabel = new Map<string, Question>();
  for (const raw of rawQuestions) {
    const normalized = normalizeLabel(String(raw.label || ""));
    if (!normalized.label) continue;
    const existing = byLabel.get(normalized.label);
    if (existing) {
      if (raw.text && !existing.text.includes(raw.text)) existing.text = `${existing.text} ${raw.text}`.trim();
      continue;
    }
    const question: Question = { id: `q-${normalized.label}`, label: normalized.label, displayNumber: normalized.displayNumber, part: normalized.part, text: String(raw.text || "").trim(), maxScore: Number(raw.maxScore) > 0 ? Number(raw.maxScore) : 0, status: "unanswered", confidence: confidence(raw.confidence) };
    result.push(question);
    byLabel.set(question.label, question);
  }
  return result;
}

export async function runPipeline(req: ProcessRequest): Promise<AssessmentResult> {
  const questionPages: PageImage[] = req.questionPages ?? [];
  const answerPages: PageImage[] = req.answerPages ?? [];
  if (!questionPages.length || !answerPages.length) throw new Error("Both a question paper and an answer sheet are required.");
  const llm = getLLM();
  const questionImages = questionPages.map((page, index) => ({ base64: page.base64, mime: page.mime, label: `QUESTION_PAGE_${index}` }));
  const answerImages = answerPages.map((page, index) => ({ base64: page.base64, mime: page.mime, label: `ANSWER_PAGE_${index}` }));

  // These independent calls run together, preserving page-level answer regions
  // while keeping total latency low enough for a serverless request.
  let questionData: { questions: RawQuestion[] };
  let answerData: { blocks: RawBlock[] };
  try {
    const [questionResult, ...answerResults] = await Promise.all([
      llm.visionJsonMulti<{ questions: RawQuestion[] }>(questionImages, QUESTION_EXTRACTION_SYSTEM, questionBatchUserText(questionPages.length), { maxTokens: 5000, responseSchema: QUESTION_RESPONSE_SCHEMA }),
      ...answerPages.map((page, index) => llm.visionJson<{ blocks: RawBlock[] }>(page.base64, ANSWER_EXTRACTION_SYSTEM, answerUserText(index, answerPages.length), { mime: page.mime, maxTokens: 3500, responseSchema: ANSWER_RESPONSE_SCHEMA }).then((result) => ({ ...result, index }))),
    ]);
    questionData = questionResult.data;
    answerData = {
      blocks: answerResults.flatMap((pageResult) => (pageResult.data?.blocks ?? []).map((block) => ({
        ...block,
        // The request is page-scoped; do not let a model-generated page number
        // move a highlight to a different uploaded image.
        page: pageResult.index,
        regions: (Array.isArray(block.regions) ? block.regions : []).map((region) => ({ ...region, page: pageResult.index })),
      }))),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI could not extract the assessment pages. ${message}`);
  }

  const questions = buildQuestions(questionData?.questions ?? []);
  if (!questions.length) throw new Error("AI returned no questions from the question paper.");
  const blocks = (answerData?.blocks ?? []).filter((block) => Number.isInteger(Number(block.page)) && Number(block.page) >= 0 && Number(block.page) < answerPages.length);
  if (!blocks.length) throw new Error("AI could not find handwritten answer blocks on the answer sheet.");
  const byLabel = new Map(questions.map((question) => [question.label, question]));

  const mappingInput = {
    questions: questions.map((question) => ({ label: question.label, text: question.text, maxScore: question.maxScore || 0 })),
    blocks: blocks.map((block, index) => ({ id: `b${index}`, page: Number(block.page), observedLabel: String(block.label || ""), transcript: String(block.transcript || "").slice(0, 700), visualDescription: String(block.visualDescription || "none"), regions: block.regions })),
  };
  let finalData: { assignments: RawAssignment[]; grades: RawGrade[]; overall: string };
  let finalProvider: Provider = llm.activeProvider;
  try {
    const result = await llm.visionJsonMulti<{ assignments: RawAssignment[]; grades: RawGrade[]; overall: string }>(answerImages, FINAL_ASSESSMENT_SYSTEM, JSON.stringify(mappingInput), { maxTokens: 5000, responseSchema: FINAL_ASSESSMENT_RESPONSE_SCHEMA });
    finalData = result.data;
    finalProvider = result.provider;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI could not reconcile the answer mapping. ${message}`);
  }

  const consumed = new Array<boolean>(blocks.length).fill(false);
  const bestByBlock = new Map<number, RawAssignment>();
  for (const rawAssignment of finalData?.assignments ?? []) {
    const id = String(rawAssignment.id || "");
    const blockIndex = Number(id.replace(/^b/, ""));
    const label = normalizeLabel(String(rawAssignment.label || "")).label;
    const matchConfidence = confidence(rawAssignment.confidence);
    if (!/^b\d+$/.test(id) || !Number.isInteger(blockIndex) || !blocks[blockIndex] || !byLabel.has(label) || matchConfidence < 0.55) continue;
    const existing = bestByBlock.get(blockIndex);
    if (!existing || confidence(existing.confidence) < matchConfidence) bestByBlock.set(blockIndex, { ...rawAssignment, confidence: matchConfidence });
  }
  const byTarget = new Map<string, Array<{ blockIndex: number; assignment: RawAssignment }>>();
  for (const [blockIndex, assignment] of bestByBlock) {
    const label = normalizeLabel(assignment.label).label;
    const target = byTarget.get(label) ?? [];
    target.push({ blockIndex, assignment });
    byTarget.set(label, target);
  }
  for (const [label, target] of byTarget) {
    const question = byLabel.get(label);
    if (!question) continue;
    const ordered = [...target].sort((a, b) => {
      const pageDifference = Number(blocks[a.blockIndex].page) - Number(blocks[b.blockIndex].page);
      if (pageDifference) return pageDifference;
      const topDifference = firstRegionTop(blocks[a.blockIndex], answerPages.length) - firstRegionTop(blocks[b.blockIndex], answerPages.length);
      return topDifference || b.assignment.confidence - a.assignment.confidence;
    });
    // Prefer the strongest physically observed section as the primary answer.
    // If the model corrected a noisy handwritten label, the assignment confidence
    // still wins; physical order then keeps continuation blocks deterministic.
    const primary = [...ordered].sort((a, b) => {
      const confidenceDifference = b.assignment.confidence - a.assignment.confidence;
      if (confidenceDifference) return confidenceDifference;
      return ordered.indexOf(a) - ordered.indexOf(b);
    })[0];
    const primaryBlock = blocks[primary.blockIndex];
    const primaryRegions = regionsFor(primaryBlock, answerPages.length);
    if (!primaryRegions.length) continue;
    const primaryConfidence = Math.min(primary.assignment.confidence, confidence(primaryBlock.confidence));
    for (const region of primaryRegions) attachRegion(question, region, String(primaryBlock.transcript || ""), String(primaryBlock.visualDescription || ""), primaryConfidence);
    consumed[primary.blockIndex] = true;
    for (const continuation of ordered.filter((entry) => {
      if (entry === primary) return false;
      const block = blocks[entry.blockIndex];
      const primaryPage = Number(primaryBlock.page);
      const blockPage = Number(block.page);
      const primaryTop = firstRegionTop(primaryBlock, answerPages.length);
      const blockTop = firstRegionTop(block, answerPages.length);
      const isUnlabeledContinuation = !String(block.label || "").trim() &&
        (blockPage > primaryPage || (blockPage === primaryPage && blockTop > primaryTop + 0.01));
      // An explicit second label is a separate answer, even if the model made
      // the same target assignment twice. This prevents two unrelated answers
      // from being merged into one green highlight.
      return !String(block.label || "").trim() && (entry.assignment.continuation || isUnlabeledContinuation);
    })) {
      const block = blocks[continuation.blockIndex];
      const regions = regionsFor(block, answerPages.length);
      if (!regions.length || consumed[continuation.blockIndex]) continue;
      const matchConfidence = Math.min(continuation.assignment.confidence, confidence(block.confidence));
      for (const region of regions) attachRegion(question, region, String(block.transcript || ""), String(block.visualDescription || ""), matchConfidence);
      consumed[continuation.blockIndex] = true;
    }
  }

  const unmatched: UnmatchedAnswer[] = blocks.flatMap((block, index) => consumed[index] ? [] : [{ label: String(block.label || "").trim() ? normalizeLabel(String(block.label)).label : undefined, transcript: String(block.transcript || "").trim(), visualDescription: String(block.visualDescription || "").trim() || undefined, regions: regionsFor(block, answerPages.length), confidence: confidence(block.confidence) }]);
  const grades = new Map((finalData?.grades ?? []).map((grade) => [normalizeLabel(grade.label).label, grade]));
  for (const question of questions) {
    const grade = grades.get(question.label);
    const inferredMax = Number(grade?.maxScore) > 0 ? Number(grade?.maxScore) : question.maxScore > 0 ? question.maxScore : 5;
    question.maxScore = question.maxScore > 0 ? question.maxScore : inferredMax;
    if (question.status === "unanswered") {
      question.score = 0;
      question.feedback = grade?.feedback || "No answer was attempted for this question.";
    } else {
      const score = Number(grade?.score);
      question.score = Number.isFinite(score) ? clamp(Math.round(score * 2) / 2, 0, question.maxScore) : undefined;
      question.feedback = grade?.feedback || "Answer recorded, but the AI did not return a grade. Review manually before assigning marks.";
    }
  }

  const maxScore = questions.reduce((sum, question) => sum + question.maxScore, 0);
  const totalScore = questions.reduce((sum, question) => sum + (question.score ?? 0), 0);
  return {
    questions,
    unmatched,
    answerPages: answerPages.map((page) => ({ w: page.w, h: page.h })),
    summary: { totalQuestions: questions.length, answeredCount: questions.filter((question) => question.status === "answered").length, totalScore, maxScore, ungradedCount: questions.filter((question) => question.status === "answered" && question.score == null).length, overall: String(finalData?.overall || "") },
    provider: finalProvider,
  };
}
