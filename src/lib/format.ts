import type { Question } from "./types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Normalize a raw question label ("Q11 (a)", "11.", "Question 3") into a
 * canonical form used for matching and display.
 *   "Q11 (a)" -> { label: "11a", displayNumber: "11", part: "a" }
 *   "3."      -> { label: "3",   displayNumber: "3" }
 */
export function normalizeLabel(raw: string): {
  label: string;
  displayNumber: string;
  part?: string;
} {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^q(uestion)?[\s.:)_-]*/i, "");
  const numMatch = cleaned.match(/\d+/);
  const displayNumber = numMatch ? numMatch[0] : cleaned.replace(/[^\dA-Za-z]/g, "");
  const partMatch = cleaned.match(/\d+\s*[.)\-\s]*\(?([a-z])\)?\b/i);
  const part = partMatch?.[1]?.toLowerCase();
  const label = part ? `${displayNumber}${part}` : displayNumber;
  return { label, displayNumber, part };
}

export type ScoreState = "full" | "partial" | "zero" | "ungraded";

/**
 * Color bucket for a score, by ratio (matches the Figma chips):
 *   ratio 0        -> zero    (red)
 *   ratio >= 0.7   -> full    (green)   e.g. 4/5, 5/5
 *   otherwise      -> partial (amber)   e.g. 3/5, 1/3
 */
export function scoreState(score?: number, max?: number): ScoreState {
  if (score == null || max == null || max <= 0) return "ungraded";
  if (score <= 0) return "zero";
  return score / max >= 0.7 ? "full" : "partial";
}

/** Tailwind classes for a score chip given its state. */
export function scoreChipClasses(state: ScoreState): string {
  switch (state) {
    case "full":
      return "bg-success-50 text-success";
    case "partial":
      return "bg-amber-50 text-amber";
    case "zero":
      return "bg-danger-50 text-danger";
    default:
      return "bg-surface-2 text-ink-45";
  }
}

export function questionScoreLabel(q: Question): string {
  if (q.status === "unanswered" || q.score == null) return `0/${q.maxScore}`;
  return `${q.score}/${q.maxScore}`;
}
