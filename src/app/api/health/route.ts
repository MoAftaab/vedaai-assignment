import { NextResponse } from "next/server";
import { getLLM } from "@/server/llm/client";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live health probe: Claude (primary) then OpenAI (fallback).
export async function GET() {
  const llm = getLLM();
  await llm.probeAndConfigureDefault();
  const body: HealthResponse = {
    activeProvider: llm.activeProvider,
    activeModel: llm.activeModel,
    providers: llm.probeStatus,
  };
  return NextResponse.json(body);
}
