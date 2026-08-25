// TEMPORARY diagnostic endpoint — delete after debugging the Vercel vision failure.
// Runs the exact AgentRouter calls the pipeline makes, server-side, and reports the
// raw status / content-block types so we can see what Vercel actually gets back.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SPOOF: Record<string, string> = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
  "User-Agent": "claude-cli/0.2.29 (external, cli)",
  "x-app": "cli",
  "x-stainless-lang": "js",
  "x-stainless-package-version": "0.33.0",
  "x-stainless-os": "Windows",
  "x-stainless-arch": "x64",
  "x-stainless-runtime": "node",
  "x-stainless-runtime-version": "v20.10.0",
};
const MINIMAL: Record<string, string> = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
};

async function tryCall(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await r.text();
    let contentTypes: string[] | null = null;
    let textLen: number | null = null;
    try {
      const j = JSON.parse(body) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      if (Array.isArray(j.content)) {
        contentTypes = j.content.map((b) => b.type ?? "?");
        textLen = j.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("").length;
      }
    } catch {
      /* not JSON */
    }
    return {
      status: r.status,
      ms: Date.now() - t0,
      contentTypes,
      textLen,
      bodyHead: body.slice(0, 300),
    };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String(e) };
  }
}

/**
 * GET /api/debug-llm?k=vd9x — quick reachability check for THIS host's egress IP.
 * Tells us whether agentrouter.org serves the real Claude API or a WAF challenge
 * page from wherever the app happens to be deployed.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("k") !== "vd9x")
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const key = process.env.AGENTROUTER_API_KEY ?? "";
  const base = (
    process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org"
  ).replace(/\/$/, "");
  const model = process.env.AGENTROUTER_MODEL ?? "claude-opus-4-8";
  const auth = { Authorization: `Bearer ${key}`, "x-api-key": key };

  const claude = await tryCall(
    `${base}/v1/messages`,
    { ...SPOOF, ...auth },
    { model, max_tokens: 10, messages: [{ role: "user", content: "ping" }] },
  );
  const head = (claude.bodyHead ?? "").toLowerCase();
  const isWaf =
    head.includes("aliyun_waf") ||
    head.includes("<!doctype html") ||
    head.includes("<html");

  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  const openai = openaiKey
    ? await tryCall(
        `${(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`,
        { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        {
          model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
          max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        },
      )
    : { status: 0, ms: 0, error: "no OPENAI_API_KEY" };

  return NextResponse.json({
    host: req.headers.get("host"),
    verdict: isWaf
      ? "BLOCKED — this host's IP gets a WAF challenge page from agentrouter.org"
      : claude.contentTypes
        ? "REACHABLE — real Claude API response"
        : `UNCLEAR — HTTP ${claude.status}`,
    claudeIsWaf: isWaf,
    claude,
    openai,
    env: {
      hasKey: Boolean(key),
      keyLen: key.length,
      base,
      model,
      hasOpenAI: Boolean(openaiKey),
    },
  });
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("k") !== "vd9x")
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { base64, mime } = (await req.json()) as {
    base64: string;
    mime?: string;
  };
  const key = process.env.AGENTROUTER_API_KEY ?? "";
  const base = (
    process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org"
  ).replace(/\/$/, "");
  const model = process.env.AGENTROUTER_MODEL ?? "claude-opus-4-8";
  const url = `${base}/v1/messages`;
  const auth = { Authorization: `Bearer ${key}`, "x-api-key": key };
  const spoof = { ...SPOOF, ...auth };
  const minimal = { ...MINIMAL, ...auth };

  const visionPayload = {
    model,
    max_tokens: 4096,
    system: "Extract questions. Respond with ONLY valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mime ?? "image/png",
              data: base64,
            },
          },
          {
            type: "text",
            text: 'Extract questions as JSON {"questions":[{"label","text","maxScore"}]}',
          },
        ],
      },
    ],
  };

  return NextResponse.json({
    env: {
      hasKey: Boolean(key),
      keyLen: key.length,
      base,
      model,
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    },
    textPing_spoof: await tryCall(url, spoof, {
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "ping" }],
    }),
    vision_spoof: await tryCall(url, spoof, visionPayload),
    vision_minimal: await tryCall(url, minimal, visionPayload),
  });
}
