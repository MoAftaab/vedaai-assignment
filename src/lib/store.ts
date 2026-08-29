"use client";
import { create } from "zustand";
import type {
  AssessmentResult,
  PageImage,
  Provider,
  ProcessResponse,
} from "./types";
import { formatBytes } from "./format";

export type Phase = "upload" | "processing" | "result" | "error";
export type ProgressStage =
  | "preparing"
  | "extracting-questions"
  | "extracting-answers"
  | "mapping-answers"
  | "grading"
  | "finishing";

export interface UploadedFile {
  file: File;
  name: string;
  sizeLabel: string;
  kind: "pdf" | "image";
  pages?: number;
}

export function toUploadedFile(file: File, pages?: number): UploadedFile {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return {
    file,
    name: file.name,
    sizeLabel: formatBytes(file.size),
    kind: isPdf ? "pdf" : "image",
    pages,
  };
}

interface State {
  phase: Phase;
  sidebarCollapsed: boolean;

  questionFile?: UploadedFile;
  answerFile?: UploadedFile;

  error?: string;
  provider?: Provider;
  progressStage?: ProgressStage;
  progressPercent: number;

  result?: AssessmentResult;
  answerPageUrls: string[]; // data URLs for the on-screen scan viewer

  selectedQuestionId?: string;
  currentPage: number; // 0-based
  zoom: number; // 1 = 100%
  expanded: Record<string, boolean>;
  expandedAll: boolean;

  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
  setQuestionFile: (f?: UploadedFile) => void;
  setAnswerFile: (f?: UploadedFile) => void;
  startMapping: () => Promise<void>;
  selectQuestion: (id: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedAll: (v: boolean) => void;
  setPage: (p: number) => void;
  setZoom: (z: number) => void;
  reset: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

export const useStore = create<State>((set, get) => ({
  phase: "upload",
  sidebarCollapsed: false,
  answerPageUrls: [],
  currentPage: 0,
  zoom: 1,
  expanded: {},
  expandedAll: false,
  progressPercent: 0,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebar: (v) => set({ sidebarCollapsed: v }),
  setQuestionFile: (f) => set({ questionFile: f, error: undefined }),
  setAnswerFile: (f) => set({ answerFile: f, error: undefined }),

  startMapping: async () => {
    const { questionFile, answerFile } = get();
    if (!questionFile || !answerFile) return;

    set({
      phase: "processing",
      error: undefined,
      sidebarCollapsed: true,
      progressStage: "preparing",
      progressPercent: 8,
    });
    try {
      const { fileToPages } = await import("./pdf");
      set({ progressStage: "preparing", progressPercent: 18 });
      const [questionRendered, answerRendered] = await Promise.all([
        fileToPages(questionFile.file, 1200),
        fileToPages(answerFile.file, 1200),
      ]);

      set({ progressStage: "extracting-questions", progressPercent: 28 });

      const toPayload = (
        pages: Awaited<ReturnType<typeof fileToPages>>,
      ): PageImage[] =>
        pages.map((p) => ({ base64: p.base64, mime: p.mime, w: p.w, h: p.h }));

      set({ progressStage: "extracting-answers", progressPercent: 44 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      set({ progressStage: "mapping-answers", progressPercent: 62 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      set({ progressStage: "grading", progressPercent: 80 });

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      let res: Response;
      try {
        res = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            questionPages: toPayload(questionRendered),
            answerPages: toPayload(answerRendered),
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Processing took too long. Try fewer pages or smaller files.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }

      const text = await res.text();
      let json: ProcessResponse;
      try {
        json = JSON.parse(text) as ProcessResponse;
      } catch {
        if (res.status === 413) {
          throw new Error(
            "Uploaded file payload exceeded the serverless limit. Please try with fewer or lower-resolution pages.",
          );
        }
        if (res.status === 504) {
          throw new Error(
            "Server processing timed out. Please try again with fewer pages.",
          );
        }
        throw new Error(
          `Server error (HTTP ${res.status}): ${text.slice(0, 150) || "Empty response"}`,
        );
      }

      if (!res.ok || !json.ok || !json.result) {
        throw new Error(json.error || `Processing failed (HTTP ${res.status})`);
      }

      set({ progressStage: "finishing", progressPercent: 96 });
      const result = json.result;
      const firstAnswered =
        result.questions.find((q) => q.status === "answered") ??
        result.questions[0];

      set({
        result,
        provider: result.provider,
        answerPageUrls: answerRendered.map((p) => p.dataUrl),
        phase: "result",
        progressStage: undefined,
        progressPercent: 100,
        zoom: 1,
        expanded: {},
        expandedAll: false,
        selectedQuestionId: firstAnswered?.id,
        currentPage: firstAnswered?.answer?.regions[0]?.page ?? 0,
      });
      if (firstAnswered) get().selectQuestion(firstAnswered.id);
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        progressStage: undefined,
        progressPercent: 0,
      });
    }
  },

  selectQuestion: (id) => {
    const q = get().result?.questions.find((x) => x.id === id);
    set((s) => ({
      selectedQuestionId: id,
      expanded: { ...s.expanded, [id]: true },
      currentPage: q?.answer?.regions[0]?.page ?? s.currentPage,
    }));
  },

  toggleExpanded: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),

  setExpandedAll: (v) => {
    const ids = get().result?.questions.map((q) => q.id) ?? [];
    const expanded: Record<string, boolean> = {};
    for (const id of ids) expanded[id] = v;
    set({ expandedAll: v, expanded });
  },

  setPage: (p) => {
    const total = get().answerPageUrls.length || 1;
    set({ currentPage: Math.max(0, Math.min(total - 1, p)) });
  },

  setZoom: (z) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) }),

  reset: () =>
    set({
      phase: "upload",
      questionFile: undefined,
      answerFile: undefined,
      result: undefined,
      answerPageUrls: [],
      error: undefined,
      selectedQuestionId: undefined,
      currentPage: 0,
      zoom: 1,
      expanded: {},
      expandedAll: false,
      progressStage: undefined,
      progressPercent: 0,
      sidebarCollapsed: false,
    }),
}));
