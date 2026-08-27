import "server-only";

/** Gemini-only server client. The API key never reaches the browser. */
export type Provider = "gemini" | "deterministic";

export interface ProbeResult { ok: boolean; status: number; message: string }

const MODEL = "gemini-2.5-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 25_000;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

function extractText(data: GeminiResponse): string {
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim();
  if (!text) throw new Error(data.error?.message || "Gemini returned no text");
  return text;
}

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  try { return JSON.parse(body); } catch {
    const start = body.search(/[\[{]/);
    if (start < 0) throw new Error("No JSON found in Gemini output");
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
    throw new Error("Unbalanced JSON in Gemini output");
  }
}

function detectMime(base64: string, fallback = "image/jpeg"): string {
  const clean = base64.trim();
  if (clean.startsWith("iVBORw0KGgo")) return "image/png";
  if (clean.startsWith("/9j/")) return "image/jpeg";
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

class LLMClient {
  private readonly apiKey = process.env.GEMINI_API_KEY ?? "";
  private readonly baseUrl = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  activeProvider: Provider = this.apiKey ? "gemini" : "deterministic";
  activeModel = MODEL;
  probeStatus: Record<string, { model: string } & ProbeResult> = {};

  private endpoint() { return `${this.baseUrl}/models/${MODEL}:generateContent?key=${encodeURIComponent(this.apiKey)}`; }

  private async generateGemini(instructions: string, input: string, image?: { base64: string; mime: string }, maxTokens = 4096): Promise<string> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured");
    const parts: Array<Record<string, unknown>> = [{ text: `${instructions}\n\n${input}` }];
    if (image) parts.push({ inline_data: { mime_type: detectMime(image.base64, image.mime), data: image.base64 } });
    const response = await fetchWithTimeout(this.endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" } }),
    });
    const body = await response.text();
    let data: GeminiResponse;
    try { data = JSON.parse(body) as GeminiResponse; } catch { throw new Error(`Gemini returned a non-JSON response (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${data.error?.message ?? body.slice(0, 200)}`);
    return extractText(data);
  }

  async probeGemini(): Promise<ProbeResult> {
    if (!this.apiKey) return { ok: false, status: 0, message: "No GEMINI_API_KEY configured" };
    try { await this.generateGemini("Return JSON.", 'Respond with {"ok":true}.', undefined, 20); return { ok: true, status: 200, message: "OK" }; }
    catch (error) { return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) }; }
  }

  async probeAndConfigureDefault(): Promise<Provider> {
    const result = await this.probeGemini();
    this.probeStatus.gemini = { model: MODEL, ...result };
    this.activeProvider = result.ok ? "gemini" : "deterministic";
    return this.activeProvider;
  }

  async generate(instructions: string, input: string, { maxTokens = 2048 } = {}) {
    const text = await this.generateGemini(instructions, input, undefined, maxTokens);
    this.activeProvider = "gemini";
    return { text, provider: "gemini" as Provider };
  }

  async generateJson<T>(instructions: string, input: string, { maxTokens = 4096 } = {}) {
    const result = await this.generate(`${instructions}\n\nRespond with ONLY valid JSON — no prose or markdown fences.`, input, { maxTokens });
    return { data: extractJson(result.text) as T, provider: result.provider };
  }

  async visionBase64(imageBase64: string, instructions: string, userText: string, { maxTokens = 4096, mime = "image/jpeg" } = {}) {
    const text = await this.generateGemini(`${instructions}\n\nRespond with ONLY valid JSON — no prose or markdown fences.`, userText, { base64: imageBase64, mime }, maxTokens);
    this.activeProvider = "gemini";
    return { text, provider: "gemini" as Provider };
  }

  async visionJson<T>(imageBase64: string, instructions: string, userText: string, options: { maxTokens?: number; mime?: "image/png" | "image/jpeg" } = {}) {
    const result = await this.visionBase64(imageBase64, instructions, userText, options);
    return { data: extractJson(result.text) as T, provider: result.provider };
  }

  hasCredentials() { return Boolean(this.apiKey); }
}

let instance: LLMClient | null = null;
export function getLLM(): LLMClient { if (!instance) instance = new LLMClient(); return instance; }
