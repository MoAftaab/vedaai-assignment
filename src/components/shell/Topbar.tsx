"use client";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Clipboard,
  HelpCircle,
  Sparkles,
  Menu,
} from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";

export default function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const phase = useStore((s) => s.phase);
  const reset = useStore((s) => s.reset);
  const provider = useStore((s) => s.provider);
  const [panel, setPanel] = useState<"help" | "notifications" | "ai" | null>(null);

  return (
    <header className="relative flex h-16 shrink-0 items-center justify-between gap-4 px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenNav} className="grid size-9 place-items-center rounded-full bg-surface text-ink shadow-sm ring-1 ring-line lg:hidden" title="Open navigation" aria-label="Open navigation">
          <Menu className="size-[18px]" />
        </button>
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
        <IconButton title="Help" active={panel === "help"} onClick={() => setPanel(panel === "help" ? null : "help")}>
          <HelpCircle className="size-[19px]" />
        </IconButton>
        <IconButton title="Notifications" active={panel === "notifications"} onClick={() => setPanel(panel === "notifications" ? null : "notifications")}>
          <span className="relative">
            <Bell className="size-[19px]" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand ring-2 ring-canvas" />
          </span>
        </IconButton>
        <IconButton title="AI" active={panel === "ai"} onClick={() => setPanel(panel === "ai" ? null : "ai")}>
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
      {panel && (
        <div className="absolute right-5 top-[60px] z-20 w-[min(320px,calc(100vw-2rem))] rounded-2xl bg-surface p-4 text-[13px] shadow-xl ring-1 ring-line">
          <p className="font-bold text-ink">{panel === "help" ? "How it works" : panel === "notifications" ? "Notifications" : "AI status"}</p>
          <p className="mt-1.5 leading-relaxed text-ink-70">
            {panel === "help" ? "Upload a question paper and a handwritten answer sheet. Select a question to jump to its highlighted answer." : panel === "notifications" ? "You’re all caught up." : `Powered by Gemini 2.5 Flash${provider === "gemini" ? " · connected" : " · waiting for a key"}.`}
          </p>
        </div>
      )}
    </header>
  );
}

function IconButton({
  title,
  children,
  active,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid size-9 place-items-center rounded-full text-ink-70 transition-colors hover:bg-surface hover:text-ink ${active ? "bg-surface text-ink" : ""}`}
    >
      {children}
    </button>
  );
}
