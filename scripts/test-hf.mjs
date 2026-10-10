// Hugging Face smoke test for TasselTrak.
// Run from the repo root (needs Node 20.6+):
//   node --env-file=web/.env.local scripts/test-hf.mjs
//
// Checks: (1) the model answers, (2) thinking can be switched off, (3) tool calling works.

const token = process.env.HF_TOKEN;
const model = process.env.HF_MODEL_ID || "Qwen/Qwen3.8-27B";
const URL = "https://router.huggingface.co/v1/chat/completions";

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

function thinkingShowedUp(r) {
  const msg = r.json?.choices?.[0]?.message ?? {};
  const content = msg.content ?? "";
  return content.includes("<think>") || Boolean(msg.reasoning || msg.reasoning_content);
}

const results = {};

// ---- Test 1: plain answer, thinking off -------------------------------------
console.log(`\nModel: ${model}\n`);
console.log("Test 1: plain answer with thinking disabled (enable_thinking=false)");
const prompt = [
  { role: "user", content: "In one sentence, why must a student pass COP 3502C before COP 3503C?" },
];
let t1 = await chat({
  messages: prompt,
  max_tokens: 300,
  chat_template_kwargs: { enable_thinking: false },
});
let t1Method = "enable_thinking=false";

if (t1.ok && thinkingShowedUp(t1)) {
  console.log("  thinking still showed up, retrying with reasoning_effort=low");
  t1 = await chat({ messages: prompt, max_tokens: 300, reasoning_effort: "low" });
  t1Method = "reasoning_effort=low";
}

if (!t1.ok) {
  console.log(`  FAIL  status ${t1.status} after ${t1.ms} ms`);
  console.log("  " + t1.text.slice(0, 600));
  results.answer = "FAIL";
  results.thinkingOff = "UNKNOWN";
} else {
  const msg = t1.json?.choices?.[0]?.message ?? {};
  const thinking = thinkingShowedUp(t1);
  console.log(`  status ${t1.status}, ${t1.ms} ms, ${t1.json?.usage?.completion_tokens ?? "?"} completion tokens`);
  console.log(`  answer: ${(msg.content ?? "").trim().slice(0, 300)}`);
  results.answer = "PASS";
  results.thinkingOff = thinking
    ? "FAIL (provider ignores the setting: strip <think>...</think> in code)"
    : `PASS (using ${t1Method})`;
}

// ---- Test 2: tool calling ----------------------------------------------------
console.log("\nTest 2: tool calling");
const t2 = await chat({
  messages: [
    { role: "system", content: "You are an academic advising assistant. Use the tools to look up data. Do not guess." },
    { role: "user", content: "Which courses can student 7 take next term?" },
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
  max_tokens: 300,
  chat_template_kwargs: { enable_thinking: false },
});

if (!t2.ok) {
  console.log(`  FAIL  status ${t2.status} after ${t2.ms} ms`);
  console.log("  " + t2.text.slice(0, 600));
  results.toolCalling = "FAIL";
} else {
  const call = t2.json?.choices?.[0]?.message?.tool_calls?.[0];
  console.log(`  status ${t2.status}, ${t2.ms} ms`);
  if (call?.function?.name === "get_eligible_courses") {
    console.log(`  tool call: ${call.function.name}(${call.function.arguments})`);
    results.toolCalling = "PASS";
  } else {
    console.log("  model answered in text instead of calling the tool:");
    console.log("  " + (t2.json?.choices?.[0]?.message?.content ?? t2.text).slice(0, 300));
    results.toolCalling = "FAIL (no tool call returned)";
  }
}

// ---- Summary -----------------------------------------------------------------
console.log("\n==== Summary ====");
console.log(`Model answers:     ${results.answer}`);
console.log(`Thinking off:      ${results.thinkingOff}`);
console.log(`Tool calling:      ${results.toolCalling}`);
console.log(`Latency (test 1):  ${t1.ms} ms`);
if (results.toolCalling !== "PASS") {
  console.log("\nIf tool calling fails: the planner can still work by asking the model for JSON and");
  console.log("calling the SQL functions from our own code. Tell Claude and we'll switch to that.");
}
