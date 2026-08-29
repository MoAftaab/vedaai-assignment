"use client";
import { Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import QuestionCard from "./QuestionCard";

function AiSummary() {
  const summary = useStore((s) => s.result?.summary);
  if (!summary) return null;
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)] ring-1 ring-line">
      <div className="flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand">
          <Sparkles className="size-[22px]" />
        </span>
        <div className="flex flex-1 items-end justify-between">
          <div>
            <p className="text-[13px] text-ink-45">Total score</p>
            <p className="text-[24px] font-extrabold leading-none text-ink">
              {summary.ungradedCount ? "—" : summary.totalScore}
              <span className="text-[16px] font-semibold text-ink-45">
                /{summary.maxScore}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[13px] text-ink-45">Answered</p>
            <p className="text-[18px] font-bold leading-none text-ink">
              {summary.answeredCount}
              <span className="text-[14px] font-semibold text-ink-45">
                /{summary.totalQuestions}
              </span>
            </p>
          </div>
        </div>
      </div>
      {summary.overall && (
          <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-70">
            {summary.overall}
          </p>
        )}
      {summary.ungradedCount > 0 && (
        <p className="mt-2 text-[12px] font-semibold text-amber">
          Score pending manual review for {summary.ungradedCount} answered question{summary.ungradedCount === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}

function UnmatchedSection() {
  const unmatched = useStore((s) => s.result?.unmatched ?? []);
  if (!unmatched.length) return null;
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)] ring-1 ring-line">
      <p className="text-[14px] font-bold text-ink">
        Unmatched answers{" "}
        <span className="font-medium text-ink-45">({unmatched.length})</span>
      </p>
      <p className="mt-0.5 text-[12px] text-ink-45">
        Transcribed from the sheet but not confidently mapped to a question.
      </p>
      <ul className="mt-3 space-y-2">
        {unmatched.map((u, i) => (
          <li
            key={i}
            className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink-70"
          >
            {u.label && (
              <span className="mr-1.5 font-semibold text-ink">{u.label}:</span>
            )}
            {u.transcript || u.visualDescription || "(diagram / non-text region)"}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function QuestionList() {
  const questions = useStore((s) => s.result?.questions ?? []);
  const expandedAll = useStore((s) => s.expandedAll);
  const setExpandedAll = useStore((s) => s.setExpandedAll);
  const reviewCount = questions.filter((q) => q.confidence != null && q.confidence < 0.75).length;
  const ungradedCount = questions.filter((q) => q.status === "answered" && q.score == null).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h2 className="text-[19px] font-bold text-ink">
          Extracted Questions{" "}
          <span className="font-medium text-ink-45">(from question paper)</span>
        </h2>
        <button
          type="button"
          onClick={() => setExpandedAll(!expandedAll)}
          className="shrink-0 rounded-full bg-surface px-4 py-2 text-[14px] font-semibold text-ink shadow-sm ring-1 ring-line transition-colors hover:bg-canvas"
        >
          {expandedAll ? "Collapse All" : "Expand All"}
        </button>
      </div>

      <div className="scroll-slim flex-1 space-y-3 overflow-y-auto pb-2 pr-1">
        {(reviewCount > 0 || ungradedCount > 0) && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber">
            <span className="font-bold">Review recommended.</span>{" "}
            {reviewCount > 0 && `${reviewCount} answer${reviewCount === 1 ? "" : "s"} need${reviewCount === 1 ? "s" : ""} a confidence check.`}{" "}
            {ungradedCount > 0 && "Some answers were not graded because AI grading was unavailable."}
          </div>
        )}
        <AiSummary />
        {questions.map((q) => (
          <QuestionCard key={q.id} q={q} />
        ))}
        <UnmatchedSection />
      </div>
    </div>
  );
}
