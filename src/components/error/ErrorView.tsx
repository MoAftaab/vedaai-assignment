"use client";
import { AlertCircle, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/store";

export default function ErrorView() {
  const error = useStore((s) => s.error);
  const reset = useStore((s) => s.reset);

  return (
    <div className="flex h-full p-4 sm:p-5">
      <div className="flex flex-1 flex-col items-center justify-center rounded-[24px] bg-surface px-6 text-center shadow-[0_12px_40px_rgba(0,0,0,0.05)]">
        <span className="grid size-16 place-items-center rounded-2xl bg-danger-50 text-danger">
          <AlertCircle className="size-8" />
        </span>
        <h2 className="mt-6 text-[26px] font-extrabold tracking-tight text-ink">
          Something went wrong
        </h2>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-70">
          {error || "We couldn't process those files. Please try again."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-panel px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-black"
        >
          <RotateCcw className="size-[18px] cursor-pointer" />
          Try again
        </button>
      </div>
    </div>
  );
}
