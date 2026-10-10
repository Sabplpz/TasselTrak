// LLM client. Providers are tried in order: OpenAI-compatible (free Gemini / Groq) -> Anthropic Claude.

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

// Pull the first JSON object out of a model reply (handles ```json fences and chatter).
export function extractJson<T = any>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(body.slice(start, end + 1));
}


// ---------------------------------------------------------------- Anthropic (Claude)

const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

async function chatClaude(
  messages: Msg[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const { maxTokens = 2000, temperature = 0.2, timeoutMs = 30000 } = opts;
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const convo = messages.filter((m) => m.role !== "system");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: convo,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const text = (json?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) throw new Error(`Anthropic empty answer (stop_reason=${json?.stop_reason ?? "?"})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- Any OpenAI-compatible API (Gemini, Groq, OpenRouter, ...)
// Gemini: LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  LLM_MODEL=gemini-2.5-flash
// Groq:   LLM_BASE_URL=https://api.groq.com/openai/v1                           LLM_MODEL=llama-3.3-70b-versatile

export const COMPAT_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

async function chatCompat(
  messages: Msg[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const key = process.env.LLM_API_KEY;
  const base = (process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
  if (!key) throw new Error("LLM_API_KEY is not set");
  const { maxTokens = 3000, temperature = 0.2, timeoutMs = 30000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: COMPAT_MODEL, messages, max_tokens: maxTokens, temperature }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${COMPAT_MODEL} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const choice = json?.choices?.[0];
    const text = stripThinking(String(choice?.message?.content ?? ""));
    if (!text) throw new Error(`${COMPAT_MODEL} empty answer (finish_reason=${choice?.finish_reason ?? "?"})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- provider routing

type Provider = "compat" | "anthropic";

const hasKey: Record<Provider, () => boolean> = {
  compat: () => !!process.env.LLM_API_KEY,
  anthropic: () => !!process.env.ANTHROPIC_API_KEY,
};

// Default order: the OpenAI-compatible one (free Gemini/Groq) -> Claude, skipping any without a key.
// LLM_PROVIDER=compat|anthropic puts one first.
function providerOrder(): Provider[] {
  const base: Provider[] = ["compat", "anthropic"];
  const want = (process.env.LLM_PROVIDER || "").toLowerCase() as Provider;
  const order = base.includes(want) ? [want, ...base.filter((p) => p !== want)] : base;
  return order.filter((p) => hasKey[p]());
}

// Tries each configured provider in order inside one time budget.
// Returns the text and the model that actually answered (stored on the plan).
export async function chat(
  messages: Msg[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; budgetMs?: number } = {}
): Promise<{ text: string; model: string }> {
  const { budgetMs = 48000, timeoutMs = 30000, maxTokens, temperature } = opts;
  const started = Date.now();
  const order = providerOrder();
  if (!order.length) throw new Error("No LLM configured: set LLM_API_KEY (Gemini/Groq) or ANTHROPIC_API_KEY");
  const errors: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const left = budgetMs - (Date.now() - started);
    if (i > 0 && left < 8000) break;
    const p = order[i];
    const t = Math.min(timeoutMs, left);
    try {
      if (p === "compat") return { text: await chatCompat(messages, { maxTokens: Math.min(maxTokens ?? 3000, 4000), temperature, timeoutMs: t }), model: COMPAT_MODEL };
      return { text: await chatClaude(messages, { maxTokens: Math.min(maxTokens ?? 2000, 4000), temperature, timeoutMs: t }), model: ANTHROPIC_MODEL };
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}
