// Hugging Face router client for Qwen3.8-27B (OpenAI-compatible).
// Findings from our test: thinking cannot be disabled, "/no_think" in the prompt is fastest,
// chat_template_kwargs is rejected, and max_tokens must be generous because thinking eats tokens.

const BASE = process.env.HF_BASE_URL || "https://router.huggingface.co/v1";
export const MODEL = process.env.HF_MODEL_ID || "Qwen/Qwen3.8-27B";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

export async function chat(
  messages: Msg[],
  opts: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number; retries?: number } = {}
): Promise<string> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is not set");
  const { model = MODEL, maxTokens = 3000, temperature = 0.2, timeoutMs = 40000, retries = 1 } = opts;

  const msgs = messages.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1];
  if (last && last.role === "user" && !last.content.includes("/no_think")) last.content += " /no_think";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HF ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const answer = stripThinking(json?.choices?.[0]?.message?.content ?? "");
      if (!answer) throw new Error("HF returned an empty answer");
      return answer;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
