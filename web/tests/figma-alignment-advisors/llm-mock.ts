// Test-only stand-in for lib/llm.ts. extractJson is the real one; chat() returns a canned plan
// (or fails like a timeout when MOCK_LLM=fail).
export { extractJson, stripThinking } from "../../lib/llm";

export async function chat(): Promise<{ text: string; model: string }> {
  if (process.env.MOCK_LLM === "fail") throw new Error("compat: This operation was aborted");
  const text = JSON.stringify({
    rationale:
      "COP 4331 and COP 4600 go first in Spring 2027. Both open up once CS II is done, and COP 4331 unlocks Senior Design. Discrete Structures II and Security round out a 12-credit term.",
    courses: [
      { code: "COP 4331", reason: "Unlocks Senior Design." },
      { code: "COP 4600", reason: "Core systems course." },
      { code: "COT 4210", reason: "Available now." },
      { code: "CIS 3360", reason: "Available now." },
    ],
  });
  return { text, model: "mock-model" };
}
