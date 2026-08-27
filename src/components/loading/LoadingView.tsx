"use client";
import { Sparkle } from "lucide-react";
import { useStore } from "@/lib/store";

const LABELS = {
  preparing: "Preparing your pages",
  "extracting-questions": "Reading the question paper",
  "extracting-answers": "Transcribing handwritten answers",
  "mapping-answers": "Mapping answers to questions",
  grading: "Reviewing answers and marks",
  finishing: "Finishing your assessment",
} as const;

export default function LoadingView() {
  const stage = useStore((s) => s.progressStage ?? "preparing");
  const percent = useStore((s) => s.progressPercent);
  return (
    <div className="flex h-full p-4 sm:p-5">
      <div className="flex flex-1 flex-col items-center justify-center rounded-[24px] bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.05)]">
        <div className="relative size-28 animate-pulse">
          <span className="absolute left-2 top-3 size-3 rounded-full bg-brand" />
          <Sparkle
            className="absolute left-4 top-3 size-16 fill-brand text-brand"
            strokeWidth={1}
          />
          <Sparkle
            className="absolute bottom-2 right-3 size-8 fill-brand text-brand"
            strokeWidth={1}
          />
        </div>
        <h2 className="mt-6 text-center text-[30px] font-extrabold tracking-tight text-ink">
          {LABELS[stage]}
        </h2>
        <p className="mt-2 text-[18px] text-ink-70">Gemini 2.5 Flash is analyzing both files</p>
        <div className="mt-7 w-full max-w-sm">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[12px] font-semibold text-ink-45">
            <span>Processing securely</span><span>{percent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
