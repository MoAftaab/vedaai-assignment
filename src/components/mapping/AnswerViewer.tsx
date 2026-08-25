"use client";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useStore } from "@/lib/store";

const ZOOM_STEP = 0.25;

export default function AnswerViewer() {
  const pageUrls = useStore((s) => s.answerPageUrls);
  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const setPage = useStore((s) => s.setPage);
  const setZoom = useStore((s) => s.setZoom);
  const selectedId = useStore((s) => s.selectedQuestionId);
  const questions = useStore((s) => s.result?.questions ?? []);

  const total = pageUrls.length;
  const selected = questions.find((q) => q.id === selectedId);
  const regions = (selected?.answer?.regions ?? []).filter(
    (r) => r.page === currentPage,
  );
  const tag = selected ? `Q${selected.displayNumber}${selected.part ?? ""}` : "";
  const pct = Math.round(zoom * 100);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[20px] bg-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-[16px] font-bold text-white">Answer Sheet</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setZoom(zoom - ZOOM_STEP)}
              className="grid size-7 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              title="Zoom out"
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-[44px] text-center text-[14px] font-semibold tabular-nums text-white">
              {pct}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(zoom + ZOOM_STEP)}
              className="grid size-7 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              title="Zoom in"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 0}
              className="grid size-7 place-items-center rounded-full text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              title="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-1 text-[14px] font-semibold tabular-nums text-white">
              Page {total ? currentPage + 1 : 0} of {total}
            </span>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= total - 1}
              className="grid size-7 place-items-center rounded-full text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              title="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scan */}
      <div className="scroll-slim scroll-slim-dark flex-1 overflow-auto p-4 pt-2">
        {total ? (
          <div
            className="mx-auto"
            style={{ width: `${pct}%`, maxWidth: zoom <= 1 ? "100%" : "none" }}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pageUrls[currentPage]}
                alt={`Answer sheet page ${currentPage + 1}`}
                className="block w-full select-none rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
              />
              {regions.map((r, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute rounded-lg border-2 border-highlight bg-highlight/10 shadow-[0_0_0_3px_rgba(52,199,89,0.15)]"
                  style={{
                    left: `${r.bbox[0] * 100}%`,
                    top: `${r.bbox[1] * 100}%`,
                    width: `${r.bbox[2] * 100}%`,
                    height: `${r.bbox[3] * 100}%`,
                  }}
                >
                  {i === 0 && tag && (
                    <span className="absolute -top-[22px] left-2 rounded-md bg-highlight px-2 py-0.5 text-[12px] font-bold text-white shadow">
                      {tag}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center text-[14px] text-white/60">
            No answer sheet pages to display.
          </div>
        )}
      </div>
    </div>
  );
}
