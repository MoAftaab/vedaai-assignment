"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, FileText, Upload, X } from "lucide-react";
import { useStore, toUploadedFile, type UploadedFile } from "@/lib/store";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function accepted(file: File) {
  return (
    file.type === "application/pdf" ||
    /\.pdf$/i.test(file.name) ||
    file.type.startsWith("image/")
  );
}

function Dropzone({
  title,
  value,
  onChange,
  onInvalid,
  className,
}: {
  title: string;
  value?: UploadedFile;
  onChange: (f?: UploadedFile) => void;
  onInvalid: (message: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file?: File | null) {
    if (!file) return;
    if (!accepted(file)) {
      onInvalid("Please choose a PDF or image file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      onInvalid("Files must be 10MB or smaller.");
      return;
    }
    onInvalid("");
    onChange(toUploadedFile(file)); // instant feedback
    try {
      const { getPageCount } = await import("@/lib/pdf");
      const pages = await getPageCount(file);
      onChange(toUploadedFile(file, pages));
    } catch {
      /* page count is best-effort */
    }
  }

  return (
    <div
      className={`relative flex min-h-[232px] items-center justify-center px-6 py-10 transition-colors ${
        dragging ? "bg-brand-50/60" : ""
      } ${className ?? ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="relative flex w-full max-w-[380px] items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3.5 ring-1 ring-line">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e5484d] text-[10px] font-bold tracking-wide text-white">
            {value.kind === "pdf" ? "PDF" : <FileText className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink">{value.name}</p>
            <p className="mt-0.5 text-[13px] text-ink-45">
              {value.sizeLabel}
              {value.pages ? ` • ${value.pages} Page${value.pages > 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            title="Remove"
            className="absolute -right-3 -top-3 grid size-7 place-items-center rounded-full bg-panel text-white shadow-md transition-colors hover:bg-black"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-4 text-center"
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-ink">
            <Upload className="size-6" strokeWidth={2} />
          </span>
          <span>
            <span className="block text-[19px] font-bold text-ink">
              Upload <span className="text-brand">{title}</span>
            </span>
            <span className="mt-1 block text-[14px] text-ink-45">Max 10MB</span>
          </span>
        </button>
      )}
    </div>
  );
}

export default function UploadView() {
  const [validationError, setValidationError] = useState("");
  const questionFile = useStore((s) => s.questionFile);
  const answerFile = useStore((s) => s.answerFile);
  const setQuestionFile = useStore((s) => s.setQuestionFile);
  const setAnswerFile = useStore((s) => s.setAnswerFile);
  const startMapping = useStore((s) => s.startMapping);
  const ready = Boolean(questionFile && answerFile);

  return (
    <div className="scroll-slim flex h-full flex-col overflow-y-auto">
      <div className="m-auto flex w-full max-w-[1160px] flex-col items-center px-6 py-10">
        <h1 className="text-center text-[40px] font-extrabold leading-[1.08] tracking-tight text-ink sm:text-[52px]">
          Upload{" "}
          <span className="box-decoration-clone rounded-2xl bg-brand-50 px-3 py-1 text-brand">
            Question Paper &amp; Answer Sheets
          </span>
        </h1>
        <p className="mt-5 text-center text-[18px] text-ink-70 sm:text-[20px]">
          Upload both files to get started
        </p>

        <Image
          src="/hero-illustration.png"
          alt=""
          width={180}
          height={180}
          priority
          className="my-8 h-[180px] w-[180px] select-none"
        />

        <div className="w-full rounded-[24px] bg-surface p-4 shadow-[0_12px_40px_rgba(0,0,0,0.04)] sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Dropzone
              title="Question Paper"
              value={questionFile}
              onChange={setQuestionFile}
              onInvalid={setValidationError}
            />
            <Dropzone
              title="Answer Sheet"
              value={answerFile}
              onChange={setAnswerFile}
              onInvalid={setValidationError}
            />
          </div>
        </div>

        {validationError && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-50 px-4 py-2.5 text-center text-[14px] font-semibold text-danger">
            {validationError}
          </p>
        )}

        <button
          type="button"
          disabled={!ready}
          onClick={() => void startMapping()}
          className={`mt-9 inline-flex items-center gap-2.5 rounded-full px-8 py-3.5 text-[16px] font-semibold shadow-sm transition-colors ${
            ready
              ? "bg-panel text-white hover:bg-black"
              : "cursor-not-allowed bg-[#dcdcdc] text-white"
          }`}
        >
          Start Mapping
          <ArrowRight className="size-[18px]" />
        </button>

        <p className="mt-5 text-center text-[14px] text-ink-45">
          Once both files are uploaded, you&apos;ll able to map answers with questions
        </p>
      </div>
    </div>
  );
}
