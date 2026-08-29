import { NextResponse } from "next/server";
import type { ProcessRequest, ProcessResponse } from "@/lib/types";
import { runPipeline } from "@/server/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: ProcessRequest;
  try {
    body = (await req.json()) as ProcessRequest;
  } catch {
    return NextResponse.json<ProcessResponse>(
      { ok: false, error: "Invalid JSON body", stage: "parse" },
      { status: 400 },
    );
  }

  if (!body?.questionPages?.length || !body?.answerPages?.length) {
    return NextResponse.json<ProcessResponse>(
      {
        ok: false,
        error: "Both a question paper and an answer sheet are required.",
        stage: "validate",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runPipeline(body);
    return NextResponse.json<ProcessResponse>({ ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Processing failed";
    const status = /Gemini HTTP 429\b/.test(error) ? 429 : 500;
    return NextResponse.json<ProcessResponse>(
      {
        ok: false,
        error,
        stage: "pipeline",
      },
      { status },
    );
  }
}
