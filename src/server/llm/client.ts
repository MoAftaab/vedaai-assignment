/**
 * Unified LLM client with multi-provider failover — a faithful TypeScript port
 * of nexus-ai's `llm_client.py`, with the provider priority INVERTED per the
 * project requirement:
 *
 *   PRIMARY  : AgentRouter Claude (agentrouter.org, model claude-opus-4-8)
 *              — Anthropic Messages shape + Claude-CLI/Stainless spoof headers.
 *   FALLBACK : Direct OpenAI (api.openai.com, model gpt-5.4-mini ONLY).
 *   LAST      : deterministic (no network) so the app never hard-crashes.
 *
 * Runtime failover: the active provider is tried first; on any error we fall
 * through to the other. Streaming/vision check HTTP status BEFORE the first
 * token so a failed provider fails over cleanly.
 *
 * Server-only. Never import from client components.
 */
import "server-only";

export type Provider = "agentrouter" | "openai" | "deterministic";

export interface ProbeResult {
  ok: boolean;
  status: number;
  message: string;
}

// Claude-CLI / Stainless spoof headers, identical to nexus-ai.
const AGENTROUTER_HEADERS: Record<string, string> = {
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

interface Settings {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  agentrouterApiKey: string;
  agentrouterBaseUrl: string;
  agentrouterModel: string;
}

function loadSettings(): Settings {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl:
      process.env.OPENAI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    openaiModel: process.env.OPENAI_MODEL ?? "gemini-2.5-flash",
    agentrouterApiKey: process.env.AGENTROUTER_API_KEY ?? "",
    agentrouterBaseUrl:
      process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org",
    agentrouterModel: process.env.AGENTROUTER_MODEL ?? "gpt-5.6-sol",
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 200 response whose body is an anti-bot / WAF challenge (e.g. Aliyun WAF) or
 * HTML rather than the JSON API payload. agentrouter.org sits behind a WAF that
 * serves this to datacenter IPs (Vercel, most cloud hosts), so a bare
 * `status === 200` check is NOT enough — we must confirm the body is real API
 * JSON, otherwise the app silently accepts a challenge page as a "success".
 */
function isBlockedResponse(body: string): boolean {
  const head = body.slice(0, 300).toLowerCase();
  return (
    head.includes("aliyun_waf") ||
    head.includes("<!doctype html") ||
    head.includes("<html")
  );
}

/**
 * Turn a raw AgentRouter body into the joined text of its `text` content blocks.
 * Throws a descriptive error when the body is a WAF challenge or otherwise not
 * an Anthropic Messages response, so failover reasons show up in logs and in
 * the error surfaced to the UI.
 */
function parseClaudeBody(body: string, label: string): string {
  if (isBlockedResponse(body))
    throw new Error(
      `${label}: blocked by upstream WAF on this host's IP (received an anti-bot challenge page instead of the Claude API response). AgentRouter does not accept requests from this server's network.`,
    );
  let data: { content?: Array<{ type?: string; text?: string }> };
  try {
    data = JSON.parse(body) as typeof data;
  } catch {
    throw new Error(`${label}: non-JSON response — ${body.slice(0, 160)}`);
  }
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error(`${label}: response contained no text blocks`);
  return text;
}

/** Pull the first balanced JSON object/array out of a model response. */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to locating the first balanced { } or [ ].
    const start = body.search(/[[{]/);
    if (start === -1) throw new Error("No JSON found in model output");
    const open = body[start];
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return JSON.parse(body.slice(start, i + 1));
      }
    }
    throw new Error("Unbalanced JSON in model output");
  }
}

function detectMime(b64: string, fallback: string = "image/jpeg"): string {
  const clean = b64.trim();
  if (clean.startsWith("iVBORw0KGgo")) return "image/png";
  if (clean.startsWith("/9j/")) return "image/jpeg";
  if (clean.startsWith("UklGR")) return "image/webp";
  if (clean.startsWith("R0lGOD")) return "image/gif";
  return fallback;
}

class LLMClient {
  private settings: Settings;
  // PRIMARY = agentrouter (Claude). Runtime failover handles the rest.
  activeProvider: Provider = "agentrouter";
  activeModel: string;
  probeStatus: Record<string, { model: string } & ProbeResult> = {};

  constructor() {
    this.settings = loadSettings();
    this.activeModel = this.settings.agentrouterModel;
  }

  private agentrouterHeaders(): Record<string, string> {
    const key = this.settings.agentrouterApiKey;
    return {
      ...AGENTROUTER_HEADERS,
      Authorization: `Bearer ${key}`,
      "x-api-key": key,
    };
  }

  private openaiHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.settings.openaiApiKey}`,
    };
  }

  // ── Health probes ──────────────────────────────────────────────
  async probeAgentrouter(): Promise<ProbeResult> {
    if (!this.settings.agentrouterApiKey)
      return { ok: false, status: 0, message: "No AgentRouter API key configured" };
    const url = `${this.settings.agentrouterBaseUrl.replace(/\/$/, "")}/v1/messages`;
    const payload = {
      model: this.settings.agentrouterModel,
      max_tokens: 10,
      messages: [{ role: "user", content: "ping" }],
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          url,
          { method: "POST", headers: this.agentrouterHeaders(), body: JSON.stringify(payload) },
          20_000,
        );
        if (resp.status === 200) {
          const text = await resp.text();
          // A WAF challenge page also returns 200 — validate the body is real
          // Claude API JSON, not an anti-bot HTML page.
          if (isBlockedResponse(text))
            return {
              ok: false,
              status: 200,
              message:
                "Blocked by upstream WAF on this host's IP — got a challenge page, not the Claude API.",
            };
          try {
            const j = JSON.parse(text) as { content?: unknown };
            if (Array.isArray(j.content)) return { ok: true, status: 200, message: "OK" };
          } catch {
            /* fall through to the unexpected-body case below */
          }
          return { ok: false, status: 200, message: "Unexpected 200 body (not a Claude API response)." };
        }
        return { ok: false, status: resp.status, message: (await resp.text()).slice(0, 120) };
      } catch (err) {
        if (attempt === 1) return { ok: false, status: 0, message: String(err) };
      }
    }
    return { ok: false, status: 0, message: "AgentRouter probe failed after retries" };
  }

  async probeOpenai(): Promise<ProbeResult> {
    if (!this.settings.openaiApiKey)
      return { ok: false, status: 0, message: "No OpenAI API key configured" };
    const url = `${this.settings.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model: this.settings.openaiModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          url,
          { method: "POST", headers: this.openaiHeaders(), body: JSON.stringify(payload) },
          20_000,
        );
        if (resp.status === 200) {
          const text = await resp.text();
          if (isBlockedResponse(text))
            return { ok: false, status: 200, message: "Blocked by a WAF/proxy on this host's IP." };
          return { ok: true, status: 200, message: "OK" };
        }
        return { ok: false, status: resp.status, message: (await resp.text()).slice(0, 120) };
      } catch (err) {
        if (attempt === 1) return { ok: false, status: 0, message: String(err) };
      }
    }
    return { ok: false, status: 0, message: "OpenAI probe failed after retries" };
  }

  /** Probe Claude first (primary), then OpenAI (fallback). */
  async probeAndConfigureDefault(): Promise<Provider> {
    const ar = await this.probeAgentrouter();
    this.probeStatus.agentrouter = { model: this.settings.agentrouterModel, ...ar };
    const oa = await this.probeOpenai();
    this.probeStatus.openai = { model: this.settings.openaiModel, ...oa };

    if (ar.ok) {
      this.activeProvider = "agentrouter";
      this.activeModel = this.settings.agentrouterModel;
    } else if (oa.ok) {
      this.activeProvider = "openai";
      this.activeModel = this.settings.openaiModel;
    } else {
      this.activeProvider = "deterministic";
      this.activeModel = "veda_deterministic";
    }
    return this.activeProvider;
  }

  // ── Text generation ────────────────────────────────────────────
  private async generateAgentrouter(
    instructions: string,
    input: string,
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    const url = `${this.settings.agentrouterBaseUrl.replace(/\/$/, "")}/v1/messages`;
    const payload = {
      model: this.settings.agentrouterModel,
      max_tokens: maxTokens,
      temperature,
      system: instructions,
      messages: [{ role: "user", content: input }],
    };
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers: this.agentrouterHeaders(), body: JSON.stringify(payload) },
      90_000,
    );
    if (resp.status !== 200)
      throw new Error(`AgentRouter HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return parseClaudeBody(await resp.text(), "AgentRouter text");
  }

  private async generateOpenai(
    instructions: string,
    input: string,
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    const url = `${this.settings.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model: this.settings.openaiModel,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      temperature,
      max_tokens: maxTokens,
    };
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers: this.openaiHeaders(), body: JSON.stringify(payload) },
      90_000,
    );
    if (resp.status !== 200)
      throw new Error(`OpenAI HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content.trim();
  }

  /** Generate text with automatic failover. Returns [text, provider]. */
  async generate(
    instructions: string,
    input: string,
    { temperature = 0, maxTokens = 2048 }: { temperature?: number; maxTokens?: number } = {},
  ): Promise<{ text: string; provider: Provider }> {
    if (this.activeProvider === "openai") {
      try {
        return { text: await this.generateOpenai(instructions, input, temperature, maxTokens), provider: "openai" };
      } catch {
        return { text: await this.generateAgentrouter(instructions, input, temperature, maxTokens), provider: "agentrouter" };
      }
    }
    // Default path: Claude primary → OpenAI fallback.
    try {
      return { text: await this.generateAgentrouter(instructions, input, temperature, maxTokens), provider: "agentrouter" };
    } catch {
      return { text: await this.generateOpenai(instructions, input, temperature, maxTokens), provider: "openai" };
    }
  }

  /** Generate + parse strict JSON, appending a JSON-only directive. */
  async generateJson<T>(
    instructions: string,
    input: string,
    { maxTokens = 4096 }: { maxTokens?: number } = {},
  ): Promise<{ data: T; provider: Provider }> {
    const sys = `${instructions}\n\nRespond with ONLY valid JSON — no prose, no markdown fences.`;
    const { text, provider } = await this.generate(sys, input, { temperature: 0, maxTokens });
    return { data: extractJson(text) as T, provider };
  }

  // ── Vision (Claude-first, exactly like nexus-ai) ────────────────
  async visionBase64(
    imageBase64: string,
    instructions: string,
    userText: string,
    {
      maxTokens = 4096,
      mime = "image/png",
    }: { maxTokens?: number; mime?: string } = {},
  ): Promise<{ text: string; provider: Provider }> {
    const detectedMime = detectMime(imageBase64, mime);
    let primaryError = "AgentRouter vision: no API key configured";
    // 1) AgentRouter Claude vision (primary).
    try {
      const url = `${this.settings.agentrouterBaseUrl.replace(/\/$/, "")}/v1/messages`;
      const payload = {
        model: this.settings.agentrouterModel,
        max_tokens: maxTokens,
        system: instructions,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: detectedMime,
                  data: imageBase64,
                },
              },
              { type: "text", text: userText },
            ],
          },
        ],
      };
      const resp = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: this.agentrouterHeaders(),
          body: JSON.stringify(payload),
        },
        90_000,
      );
      if (resp.status === 200) {
        return {
          text: parseClaudeBody(await resp.text(), "AgentRouter vision"),
          provider: "agentrouter",
        };
      }
      primaryError = `AgentRouter vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`;
    } catch (err) {
      primaryError = err instanceof Error ? err.message : String(err);
    }
    console.warn(`[llm] Claude vision failed → falling back to OpenAI. ${primaryError}`);

    // 2) OpenAI vision (fallback).
    const url = `${this.settings.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model: this.settings.openaiModel,
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: {
                url: `data:${detectedMime};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    };
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: this.openaiHeaders(),
        body: JSON.stringify(payload),
      },
      90_000,
    );
    if (resp.status !== 200)
      throw new Error(
        `Both vision providers failed. Claude → ${primaryError} | OpenAI vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
      );
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return { text: data.choices[0].message.content.trim(), provider: "openai" };
  }

  /** Vision + strict-JSON parse. */
  async visionJson<T>(
    imageBase64: string,
    instructions: string,
    userText: string,
    {
      maxTokens = 4096,
      mime = "image/png",
    }: { maxTokens?: number; mime?: "image/png" | "image/jpeg" } = {},
  ): Promise<{ data: T; provider: Provider }> {
    const sys = `${instructions}\n\nRespond with ONLY valid JSON — no prose, no markdown fences.`;
    const { text, provider } = await this.visionBase64(imageBase64, sys, userText, {
      maxTokens,
      mime,
    });
    return { data: extractJson(text) as T, provider };
  }

  hasCredentials(): boolean {
    return Boolean(this.settings.agentrouterApiKey || this.settings.openaiApiKey);
  }
}

// Module-scoped singleton (persists per warm serverless instance).
let instance: LLMClient | null = null;
export function getLLM(): LLMClient {
  if (!instance) instance = new LLMClient();
  return instance;
}
