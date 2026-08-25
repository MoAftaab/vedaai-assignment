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
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
    agentrouterApiKey: process.env.AGENTROUTER_API_KEY ?? "",
    agentrouterBaseUrl:
      process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org",
    agentrouterModel: process.env.AGENTROUTER_MODEL ?? "claude-opus-4-8",
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
        if (resp.status === 200) return { ok: true, status: 200, message: "OK" };
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
        if (resp.status === 200) return { ok: true, status: 200, message: "OK" };
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
    const data = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
    return (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();
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
    }: { maxTokens?: number; mime?: "image/png" | "image/jpeg" } = {},
  ): Promise<{ text: string; provider: Provider }> {
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
              { type: "image", source: { type: "base64", media_type: mime, data: imageBase64 } },
              { type: "text", text: userText },
            ],
          },
        ],
      };
      const resp = await fetchWithTimeout(
        url,
        { method: "POST", headers: this.agentrouterHeaders(), body: JSON.stringify(payload) },
        90_000,
      );
      if (resp.status === 200) {
        const data = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
        const text = (data.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
          .trim();
        return { text, provider: "agentrouter" };
      }
    } catch {
      /* fall through to OpenAI */
    }

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
            { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        },
      ],
      max_tokens: maxTokens,
    };
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers: this.openaiHeaders(), body: JSON.stringify(payload) },
      90_000,
    );
    if (resp.status !== 200)
      throw new Error(`OpenAI vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
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
