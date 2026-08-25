"use client";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Question } from "@/lib/types";
import { useStore } from "@/lib/store";
import ScoreChip from "./ScoreChip";

export default function QuestionCard({ q }: { q: Question }) {
  const selected = useStore((s) => s.selectedQuestionId === q.id);
  const expanded = useStore((s) => !!s.expanded[q.id]);
  const selectQuestion = useStore((s) => s.selectQuestion);
  const toggleExpanded = useStore((s) => s.toggleExpanded);

  return (
    <div
      className={`rounded-2xl bg-surface transition-shadow ${
        selected
          ? "shadow-[0_6px_22px_rgba(252,72,24,0.12)] ring-2 ring-brand"
          : "shadow-[0_2px_10px_rgba(0,0,0,0.03)] ring-1 ring-line"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectQuestion(q.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectQuestion(q.id);
          }
        }}
        className="flex cursor-pointer items-start gap-3.5 px-4 py-4"
      >
        <span
          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white transition-colors ${
            selected ? "bg-brand" : "bg-panel"
          }`}
        >
          {q.displayNumber}
        </span>

        {q.part && (
          <span className="mt-2 w-3.5 shrink-0 text-[15px] font-semibold text-ink-70">
            {q.part}.
          </span>
        )}

        <span className="min-w-0 flex-1 pt-1.5 text-[15px] font-medium leading-snug text-ink">
          {q.text || (
            <span className="text-ink-45">No question text detected</span>
          )}
        </span>

        <span className="mt-1">
          <ScoreChip q={q} />
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(q.id);
          }}
          title={expanded ? "Collapse" : "Expand"}
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-70 ring-1 ring-line transition-colors hover:text-ink"
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <div className="rounded-xl bg-surface-2 p-4">
            <p className="text-[14px] font-bold text-ink">AI Feedback</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-70">
              {q.feedback || "No feedback available for this question."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
