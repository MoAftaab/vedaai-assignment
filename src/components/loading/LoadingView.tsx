"use client";
import { Sparkle } from "lucide-react";

export default function LoadingView() {
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
        <h2 className="mt-6 text-[30px] font-extrabold tracking-tight text-ink">
          Extracting...
        </h2>
        <p className="mt-2 text-[18px] text-ink-70">This may take a while</p>
      </div>
    </div>
  );
}
