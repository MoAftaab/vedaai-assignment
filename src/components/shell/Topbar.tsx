"use client";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Clipboard,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/store";

export default function Topbar() {
  const phase = useStore((s) => s.phase);
  const reset = useStore((s) => s.reset);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => phase !== "upload" && reset()}
          className="grid size-9 place-items-center rounded-full bg-surface text-ink shadow-sm ring-1 ring-line transition-colors hover:bg-canvas"
          title="Back"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <div className="flex items-center gap-2 text-ink-70">
          <Clipboard className="size-[18px]" strokeWidth={1.9} />
          <span className="text-[15px] font-medium">Exams</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <IconButton title="Help">
          <HelpCircle className="size-[19px]" />
        </IconButton>
        <IconButton title="Notifications">
          <span className="relative">
            <Bell className="size-[19px]" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand ring-2 ring-canvas" />
          </span>
        </IconButton>
        <IconButton title="AI">
          <Sparkles className="size-[19px]" />
        </IconButton>
        <button
          type="button"
          className="ml-1 flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-surface"
        >
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand text-[13px] font-bold text-white">
            MR
          </span>
          <span className="hidden text-[15px] font-semibold text-ink sm:block">
            Madhur Rastogi
          </span>
          <ChevronDown className="size-4 text-ink-45" />
        </button>
      </div>
    </header>
  );
}

function IconButton({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className="grid size-9 place-items-center rounded-full text-ink-70 transition-colors hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}
