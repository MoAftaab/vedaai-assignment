// Shared data model for the assessment extraction + mapping pipeline.
// Everything is held in memory (no DB / auth) per the assignment constraints.

export type Provider = "gemini" | "deterministic";

/** Normalized bounding box on a page: [x, y, w, h], each in 0..1. */
export type BBox = [number, number, number, number];

/** A highlighted region of the answer sheet (a question's answer may span pages). */
export interface Region {
  page: number; // 0-based page index into answerPages
  bbox: BBox;
}

export interface Answer {
  transcript: string;
  visualDescription?: string;
  regions: Region[];
  confidence?: number;
}

export interface Question {
  id: string; // stable id, e.g. "q-11a"
  label: string; // canonical label used for matching, e.g. "11a"
  displayNumber: string; // "11"
  part?: string; // "a" | "b" | ...
  text: string;
  maxScore: number;
  status: "answered" | "unanswered";
  answer?: Answer;
  score?: number; // 0..maxScore
  feedback?: string;
  confidence?: number;
}

/** A transcribed answer block that could not be matched to any question. */
export interface UnmatchedAnswer {
  label?: string; // label written on the sheet, if any (e.g. "Q7")
  transcript: string;
  visualDescription?: string;
  regions: Region[];
  confidence?: number;
}

export interface PageMeta {
  w: number;
  h: number;
}

export interface AssessmentResult {
  questions: Question[];
  unmatched: UnmatchedAnswer[];
  answerPages: PageMeta[];
  summary: {
    totalQuestions: number;
    answeredCount: number;
    totalScore: number;
    maxScore: number;
    ungradedCount: number;
    overall: string;
  };
  provider: Provider;
}

// ── API contracts ────────────────────────────────────────────────
export interface PageImage {
  base64: string; // raw base64 (no data: prefix)
  mime: "image/png" | "image/jpeg";
  w: number; // natural rendered width in px
  h: number; // natural rendered height in px
}

export interface ProcessRequest {
  questionPages: PageImage[];
  answerPages: PageImage[];
}

export interface ProcessResponse {
  ok: boolean;
  result?: AssessmentResult;
  error?: string;
  stage?: string;
}

export interface HealthResponse {
  activeProvider: Provider;
  activeModel: string;
  providers: Record<
    string,
    { model: string; ok: boolean; status: number; message: string }
  >;
}
