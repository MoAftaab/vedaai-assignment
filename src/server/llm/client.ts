import "server-only";

/** Server-side multimodal client with configurable provider order and fallback. */
export type Provider = "gemini" | "agent-router" | "deterministic";

export interface ProbeResult { ok: boolean; status: number; message: string }

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const ROUTER_BASE_URL = "https://agentrouter.org";
const REQUEST_TIMEOUT_MS = 90_000;
const ROUTER_REQUEST_TIMEOUT_MS = 20_000;
const MAX_ROUTER_MODELS_PER_REQUEST = 3;

interface ProviderResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export interface VisionImage {
  base64: string;
  mime: string;
  label?: string;
}

type JsonSchema = Record<string, unknown>;

interface GenerateOptions {
  maxTokens?: number;
  responseSchema?: JsonSchema;
}

const DEFAULT_ROUTER_MODELS = [
  "claude-opus-4-8",
  "gpt-5.6-sol",
  "claude-opus-5",
  "deepseek-v4-flash",
  "glm-5.3",
];

function configuredModels(): string[] {
  const env = process.env.AGENT_ROUTER_MODELS ?? process.env.AGENTROUTER_MODELS ?? process.env.AGENTROUTER_MODEL ?? "";
  const list = env
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ROUTER_MODELS;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function routerRoot(): string {
  return withoutTrailingSlash(process.env.AGENT_ROUTER_BASE_URL ?? process.env.AGENTROUTER_BASE_URL ?? ROUTER_BASE_URL).replace(/\/v1$/, "");
}

function extractProviderText(data: ProviderResponse): string {
  const geminiText = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim();
  if (geminiText) return geminiText;
  const content = data.choices?.[0]?.message?.content ?? data.content ?? "";
  const routerText = Array.isArray(content) ? content.map((part) => part.text ?? "").join("\n").trim() : String(content).trim();
  if (routerText) return routerText;
  throw new Error(data.error?.message || "AI provider returned no text");
}

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  try { return JSON.parse(body); } catch {
    const start = body.search(/[\[{]/);
    if (start < 0) throw new Error("No JSON found in model output");
    const open = body[start];
    const close = open === "[" ? "]" : "}";
    let depth = 0; let inString = false; let escaped = false;
    for (let i = start; i < body.length; i += 1) {
      const ch = body[i];
      if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
    throw new Error("Unbalanced JSON in model output");
  }
}

function detectMime(base64: string, fallback = "image/jpeg"): string {
  const clean = base64.trim();
  if (clean.startsWith("iVBORw0KGgo")) return "image/png";
  if (clean.startsWith("/9j/")) return "image/jpeg";
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function jsonBody(response: Response): Promise<ProviderResponse> {
  const body = await response.text();
  try { return JSON.parse(body) as ProviderResponse; }
  catch { throw new HttpError(response.status, `AI provider returned a non-JSON response (HTTP ${response.status})`); }
}

class LLMClient {
  private readonly geminiKey = process.env.GEMINI_API_KEY ?? "";
  private readonly routerKey = process.env.AGENT_ROUTER_API_KEY ?? process.env.AGENTROUTER_API_KEY ?? "";
  private readonly routerFormat = (process.env.AGENT_ROUTER_API_FORMAT ?? "auto").toLowerCase();
  private readonly preferredProvider = (process.env.PRIMARY_LLM_PROVIDER ?? (this.routerKey ? "agent-router" : "gemini")).toLowerCase();
  activeProvider: Provider = this.preferredProvider === "agent-router" && this.routerKey
    ? "agent-router"
    : this.geminiKey
    ? "gemini"
    : this.routerKey
    ? "agent-router"
    : "deterministic";
  activeModel = this.activeProvider === "gemini" ? GEMINI_MODEL : configuredModels()[0] ?? "";
  probeStatus: Record<string, { model: string } & ProbeResult> = {};

  private geminiEndpoint() { return `${withoutTrailingSlash(process.env.GEMINI_BASE_URL ?? GEMINI_BASE_URL)}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(this.geminiKey)}`; }
  private geminiModelEndpoint() { return `${withoutTrailingSlash(process.env.GEMINI_BASE_URL ?? GEMINI_BASE_URL)}/models/${GEMINI_MODEL}?key=${encodeURIComponent(this.geminiKey)}`; }
  private routerOpenAIEndpoint() { return `${routerRoot()}/v1/chat/completions`; }
  private routerAnthropicEndpoint() { return `${routerRoot()}/v1/messages`; }

  private async generateGemini(instructions: string, input: string, images: VisionImage[] = [], { maxTokens = 4096, responseSchema }: GenerateOptions = {}): Promise<string> {
    if (!this.geminiKey) throw new Error("GEMINI_API_KEY is not configured");
    const parts: Array<Record<string, unknown>> = [{ text: `${instructions}\n\n${input}` }];
    for (const image of images) {
      if (image.label) parts.push({ text: `\n[BEGIN ATTACHED IMAGE: ${image.label}]` });
      parts.push({ inline_data: { mime_type: detectMime(image.base64, image.mime), data: image.base64 } });
      if (image.label) parts.push({ text: `[END ATTACHED IMAGE: ${image.label}]\n` });
    }
    const response = await fetchWithTimeout(this.geminiEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json", ...(responseSchema ? { responseSchema } : {}) } }),
    });
    const data = await jsonBody(response);
    if (!response.ok) throw new HttpError(response.status, `Gemini HTTP ${response.status}: ${data.error?.message ?? "request failed"}`);
    return extractProviderText(data);
  }

  private isAnthropicModel(model: string): boolean {
    if (this.routerFormat === "anthropic" || this.routerFormat === "messages") return true;
    if (this.routerFormat === "openai" || this.routerFormat === "chat-completions") return false;
    return /^claude(?:-|$)/i.test(model);
  }

  private async generateAgentRouter(model: string, instructions: string, input: string, images: VisionImage[] = [], maxTokens = 4096): Promise<string> {
    if (!this.routerKey) throw new Error("AGENT_ROUTER_API_KEY is not configured");
    if (this.isAnthropicModel(model)) {
      const content: Array<Record<string, unknown>> = [{ type: "text", text: input }];
      for (const image of images) {
        content.push({ type: "text", text: `[BEGIN ATTACHED IMAGE: ${image.label ?? "answer page"}]` });
        content.push({ type: "image", source: { type: "base64", media_type: detectMime(image.base64, image.mime), data: image.base64 } });
        content.push({ type: "text", text: `[END ATTACHED IMAGE: ${image.label ?? "answer page"}]` });
      }
      const response = await fetchWithTimeout(this.routerAnthropicEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.routerKey}`,
          "x-api-key": this.routerKey,
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
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system: instructions, messages: [{ role: "user", content }] }),
      }, ROUTER_REQUEST_TIMEOUT_MS);
      const data = await jsonBody(response);
      if (!response.ok) throw new HttpError(response.status, `Agent Router HTTP ${response.status} (${model}): ${data.error?.message ?? "request failed"}`);
      return extractProviderText(data);
    }

    const content: Array<Record<string, unknown>> = [{ type: "text", text: `${instructions}\n\n${input}` }];
    for (const image of images) content.push({ type: "image_url", image_url: { url: `data:${detectMime(image.base64, image.mime)};base64,${image.base64}` } });
    const response = await fetchWithTimeout(this.routerOpenAIEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.routerKey}`,
        "User-Agent": "claude-cli/0.2.29 (external, cli)",
        "x-app": "cli",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" } }),
    }, ROUTER_REQUEST_TIMEOUT_MS);
    const data = await jsonBody(response);
    if (!response.ok) throw new HttpError(response.status, `Agent Router HTTP ${response.status} (${model}): ${data.error?.message ?? "request failed"}`);
    return extractProviderText(data);
  }

  private async generateWithFallback(instructions: string, input: string, images: VisionImage[], options: GenerateOptions, validateJson = false): Promise<{ text: string; provider: Provider; model: string }> {
    const failures: string[] = [];
    const preferred = (process.env.PRIMARY_LLM_PROVIDER ?? (this.routerKey ? "agent-router" : "gemini")).toLowerCase();

    const tryGemini = async () => {
      if (!this.geminiKey) return null;
      try {
        const text = await this.generateGemini(instructions, input, images, options);
        if (validateJson) extractJson(text);
        this.activeProvider = "gemini";
        this.activeModel = GEMINI_MODEL;
        return { text, provider: "gemini" as Provider, model: GEMINI_MODEL };
      } catch (error) {
        failures.push(`Gemini: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    const tryAgentRouter = async () => {
      if (!this.routerKey) return null;
      const models = configuredModels().slice(0, MAX_ROUTER_MODELS_PER_REQUEST);
      if (!models.length) failures.push("AGENT_ROUTER_MODELS is not configured");
      for (const model of models) {
        try {
          const text = await this.generateAgentRouter(model, instructions, input, images, options.maxTokens ?? 4096);
          if (validateJson) extractJson(text);
          this.activeProvider = "agent-router";
          this.activeModel = model;
          return { text, provider: "agent-router" as Provider, model };
        } catch (error) {
          failures.push(`Agent Router (${model}): ${error instanceof Error ? error.message : String(error)}`);
          // Invalid credentials, unsupported endpoints, and unknown models are
          // configuration failures; retrying other models only adds latency.
          if (error instanceof HttpError && [400, 401, 403, 404].includes(error.status)) break;
        }
      }
      return null;
    };

    if (preferred === "agent-router") {
      const res = await tryAgentRouter();
      if (res) return res;
      const fallback = await tryGemini();
      if (fallback) return fallback;
    } else {
      const res = await tryGemini();
      if (res) return res;
      const fallback = await tryAgentRouter();
      if (fallback) return fallback;
    }

    throw new Error(`All configured AI providers failed. ${failures.join(" | ") || "No provider key is configured."}`);
  }

  async probeGemini(): Promise<ProbeResult> {
    if (!this.geminiKey) return { ok: false, status: 0, message: "No GEMINI_API_KEY configured" };
    try {
      const response = await fetchWithTimeout(this.geminiModelEndpoint(), { method: "GET" });
      if (!response.ok) { const data = await jsonBody(response); return { ok: false, status: response.status, message: data.error?.message ?? "Gemini model probe failed" }; }
      return { ok: true, status: response.status, message: "OK" };
    } catch (error) { return { ok: false, status: error instanceof HttpError ? error.status : 0, message: error instanceof Error ? error.message : String(error) }; }
  }

  async probeAgentRouter(): Promise<ProbeResult> {
    const models = configuredModels();
    if (!this.routerKey) return { ok: false, status: 0, message: "No AGENT_ROUTER_API_KEY configured" };
    if (!models.length) return { ok: false, status: 0, message: "No AGENT_ROUTER_MODELS configured" };
    try {
      const response = await fetchWithTimeout(`${routerRoot()}/v1/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.routerKey}`,
          "User-Agent": "claude-cli/0.2.29 (external, cli)",
          "x-app": "cli",
        },
      });
      if (!response.ok) { const data = await jsonBody(response); return { ok: false, status: response.status, message: data.error?.message ?? "Agent Router model probe failed" }; }
      return { ok: true, status: response.status, message: `Configured models: ${models.join(", ")}` };
    } catch (error) { return { ok: false, status: error instanceof HttpError ? error.status : 0, message: error instanceof Error ? error.message : String(error) }; }
  }

  async probeAndConfigureDefault(): Promise<Provider> {
    const gemini = await this.probeGemini();
    this.probeStatus.gemini = { model: GEMINI_MODEL, ...gemini };
    const router = await this.probeAgentRouter();
    this.probeStatus["agent-router"] = { model: configuredModels().join(",") || "(none)", ...router };
    const preferred = (process.env.PRIMARY_LLM_PROVIDER ?? (this.routerKey ? "agent-router" : "gemini")).toLowerCase();
    if (preferred === "agent-router" && router.ok) {
      this.activeProvider = "agent-router";
      this.activeModel = configuredModels()[0] ?? "";
    } else if (gemini.ok) {
      this.activeProvider = "gemini";
      this.activeModel = GEMINI_MODEL;
    } else if (router.ok) {
      this.activeProvider = "agent-router";
      this.activeModel = configuredModels()[0] ?? "";
    } else {
      this.activeProvider = "deterministic";
      this.activeModel = "";
    }
    return this.activeProvider;
  }

  async generate(instructions: string, input: string, options: GenerateOptions = {}) {
    return this.generateWithFallback(instructions, input, [], options);
  }

  async generateJson<T>(instructions: string, input: string, options: GenerateOptions = {}) {
    const result = await this.generateWithFallback(`${instructions}\n\nRespond with ONLY valid JSON — no prose or markdown fences.`, input, [], options, true);
    return { data: extractJson(result.text) as T, provider: result.provider };
  }

  async visionBase64(imageBase64: string, instructions: string, userText: string, { maxTokens = 4096, mime = "image/jpeg", responseSchema }: GenerateOptions & { mime?: "image/png" | "image/jpeg" } = {}) {
    const result = await this.generateWithFallback(`${instructions}\n\nRespond with ONLY valid JSON — no prose or markdown fences.`, userText, [{ base64: imageBase64, mime }], { maxTokens, responseSchema }, true);
    return { text: result.text, provider: result.provider };
  }

  async visionJson<T>(imageBase64: string, instructions: string, userText: string, options: GenerateOptions & { mime?: "image/png" | "image/jpeg" } = {}) {
    const result = await this.visionBase64(imageBase64, instructions, userText, options);
    return { data: extractJson(result.text) as T, provider: result.provider };
  }

  async visionJsonMulti<T>(images: VisionImage[], instructions: string, userText: string, options: GenerateOptions = {}) {
    const result = await this.generateWithFallback(`${instructions}\n\nRespond with ONLY valid JSON — no prose or markdown fences.`, userText, images, options, true);
    return { data: extractJson(result.text) as T, provider: result.provider };
  }

  hasCredentials() { return Boolean(this.geminiKey || this.routerKey); }
}

let instance: LLMClient | null = null;
export function getLLM(): LLMClient { if (!instance) instance = new LLMClient(); return instance; }
