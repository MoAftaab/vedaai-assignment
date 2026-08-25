import type { Question } from "@/lib/types";
import { scoreState, scoreChipClasses, questionScoreLabel } from "@/lib/format";

export default function ScoreChip({ q }: { q: Question }) {
  const state = scoreState(q.score, q.maxScore);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[14px] font-bold tabular-nums ${scoreChipClasses(
        state,
      )}`}
    >
      {questionScoreLabel(q)}
    </span>
  );
}
