// Hugging Face smoke test for TasselTrak (v2).
// Run from the repo root (needs Node 20.6+):
//   node --env-file=web/.env.local scripts/test-hf.mjs
//
// v1 failed because the HF router rejects `chat_template_kwargs`. This version never sends it.
// It tries several ways of keeping the model's "thinking" short, tells you which one works,
// then runs the tool-calling test with the best one.

const token = process.env.HF_TOKEN;
const model = process.env.HF_MODEL_ID || "Qwen/Qwen3.8-27B";
const URL = process.env.HF_URL || "https://router.huggingface.co/v1/chat/completions";

if (!token) {
  console.error("HF_TOKEN is missing. Put it in web/.env.local and run with --env-file=web/.env.local");
  process.exit(1);
}

async function chat(body) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...body }),
    });
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, json: null, text: String(err) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, json, text };
}

const messageOf = (r) => r.json?.choices?.[0]?.message ?? {};
const thinkingPresent = (r) => {
  const m = messageOf(r);
  return (m.content ?? "").includes("<think>") || Boolean(m.reasoning || m.reasoning_content);
};
const stripThink = (s) => (s ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// Ways to ask for less thinking. None of them use chat_template_kwargs.
const variants = [
  { name: "default (no setting)", extra: {}, suffix: "" },
  { name: "reasoning_effort=low", extra: { reasoning_effort: "low" }, suffix: "" },
  { name: "/no_think added to the prompt", extra: {}, suffix: " /no_think" },
];

const question = "In one sentence, why must a student pass COP 3502C before COP 3503C?";

console.log(`\nModel: ${model}`);
console.log("\nTest 1: ways to keep thinking short (same question each time)\n");

const rows = [];
for (const v of variants) {
  const r = await chat({
    messages: [{ role: "user", content: question + v.suffix }],
    max_tokens: 600,
    ...v.extra,
  });
  const row = { v, r, thinking: r.ok ? thinkingPresent(r) : null };
  rows.push(row);
  if (!r.ok) {
    const msg = r.json?.error?.message ?? r.json?.message ?? r.text;
    console.log(`  ${v.name.padEnd(32)} FAIL  status ${r.status}: ${String(msg).slice(0, 160)}`);
  } else {
    const tokens = r.json?.usage?.completion_tokens ?? "?";
    console.log(
      `  ${v.name.padEnd(32)} ok    ${String(r.ms).padStart(5)} ms  ${String(tokens).padStart(4)} tokens  thinking: ${row.thinking ? "YES" : "no"}`
    );
  }
}

const working = rows.filter((x) => x.r.ok);
const clean = working.filter((x) => !x.thinking).sort((a, b) => a.r.ms - b.r.ms);
const best = clean[0] ?? working.sort((a, b) => a.r.ms - b.r.ms)[0] ?? null;

let answerOk = "FAIL";
let thinkingVerdict = "UNKNOWN";
let recommended = null;

if (best) {
  answerOk = "PASS";
  recommended = best.v;
  const answer = stripThink(messageOf(best.r).content);
  console.log(`\n  answer (${best.v.name}): ${answer.slice(0, 300)}`);
  thinkingVerdict = clean.length
    ? `PASS, use "${best.v.name}"`
    : "NO SETTING WORKED: thinking stays on. Strip <think>...</think> in code and expect slow, token-heavy replies";
}

// ---- Test 2: tool calling, with the best setting -----------------------------
console.log("\nTest 2: tool calling" + (recommended ? ` (using "${recommended.name}")` : ""));
const t2 = await chat({
  messages: [
    { role: "system", content: "You are an academic advising assistant. Use the tools to look up data. Do not guess." },
    { role: "user", content: "Which courses can student 7 take next term?" + (recommended?.suffix ?? "") },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_eligible_courses",
        description: "Return the courses a student is eligible to take (prerequisites satisfied).",
        parameters: {
          type: "object",
          properties: { student_id: { type: "integer", description: "The student's id" } },
          required: ["student_id"],
        },
      },
    },
  ],
  tool_choice: "auto",
  max_tokens: 600,
  ...(recommended?.extra ?? {}),
});

let toolVerdict;
if (!t2.ok) {
  const msg = t2.json?.error?.message ?? t2.json?.message ?? t2.text;
  console.log(`  FAIL  status ${t2.status} after ${t2.ms} ms: ${String(msg).slice(0, 300)}`);
  toolVerdict = "FAIL";
} else {
  const call = messageOf(t2).tool_calls?.[0];
  console.log(`  status ${t2.status}, ${t2.ms} ms`);
  if (call?.function?.name === "get_eligible_courses") {
    console.log(`  tool call: ${call.function.name}(${call.function.arguments})`);
    toolVerdict = "PASS";
  } else {
    console.log("  model answered in text instead of calling the tool:");
    console.log("  " + stripThink(messageOf(t2).content ?? t2.text).slice(0, 300));
    toolVerdict = "FAIL (no tool call returned)";
  }
}

// ---- Summary -----------------------------------------------------------------
console.log("\n==== Summary ====");
console.log(`Model answers:   ${answerOk}`);
console.log(`Thinking short:  ${thinkingVerdict}`);
console.log(`Tool calling:    ${toolVerdict}`);
if (recommended) {
  console.log(`\nUse in the app: extra body = ${JSON.stringify(recommended.extra)}, prompt suffix = ${JSON.stringify(recommended.suffix)}`);
}
if (!best) {
  console.log("\nNo request succeeded. Check, in order:");
  console.log("  1. HF_TOKEN is a token with permission to call Inference Providers (fine-grained tokens need it ticked).");
  console.log("  2. Try pinning a provider: HF_MODEL_ID=Qwen/Qwen3.8-27B:novita");
  console.log("  3. Paste the error lines above to Claude.");
}
if (toolVerdict !== "PASS") {
  console.log("\nIf tool calling fails, the planner can still work: ask the model for JSON and call the SQL");
  console.log("functions from our own code. Tell Claude and we'll switch to that.");
}
