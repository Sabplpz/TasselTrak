// End-to-end check of the TasselTrak API. Needs `npm run dev` running.
//   node scripts/smoke-test.mjs            (default http://localhost:3000)
//   BASE=https://your-app.vercel.app node scripts/smoke-test.mjs
// It creates a plan for Sofia Ramirez and approves it, so the database changes.
const BASE = process.env.BASE || "http://localhost:3000";
let failed = 0;

async function call(method, path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, ms: Date.now() - t };
}
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  if (!cond) failed++;
}

let r = await call("GET", "/api/health");
check("health", r.status === 200 && r.json?.ok, `tables: ${r.json?.tables}`);

r = await call("GET", "/api/advisors");
check("advisors", r.status === 200 && r.json?.advisors?.length >= 2, `${r.json?.advisors?.length} advisors`);

r = await call("GET", "/api/caseload");
check("caseload", r.status === 200 && r.json?.students?.length === 20, `${r.json?.students?.length} students, ${r.json?.summary?.needs_attention} need attention`);
const sofia = r.json?.students?.find((s) => s.display_name === "Sofia Ramirez");
check("found Sofia", !!sofia);
if (!sofia) process.exit(1);
const sid = sofia.student_id;

r = await call("GET", `/api/students/${sid}`);
check("student detail", r.status === 200 && r.json?.completed?.length > 0 && r.json?.flags?.length > 0,
  `${r.json?.completed?.length} courses, ${r.json?.flags?.length} flags, ${r.json?.remaining?.length} remaining`);
const ineligible = r.json?.remaining?.find((c) => !c.eligible);
check("has an ineligible requirement to test with", !!ineligible, ineligible?.code);

console.log("\n... generating a plan with Qwen (can take 10-40 s)");
r = await call("POST", `/api/students/${sid}/plan`, { advisorId: 1 });
check("generate plan", r.status === 201 && r.json?.items?.length > 0, `${r.ms} ms, model ${r.json?.plan?.modelName}, ${r.json?.totals?.credits} credits`);
if (r.status !== 201) { console.log(r.json); process.exit(1); }
if (r.json.plan.modelName === "rules-fallback") console.log("WARN  Qwen failed, rules fallback was used:", r.json.plan.rationale);
let plan = r.json;
const pid = plan.plan.id;
console.log("      items:", plan.items.map((i) => `${i.code}${i.section ? "" : "(slot)"}`).join(", "));
console.log("      rationale:", plan.plan.rationale);
check("every item has a reason", plan.items.every((i) => i.reason));

r = await call("GET", `/api/plans/${pid}`);
check("get plan", r.status === 200 && r.json?.plan?.id === pid);

const item = plan.items[0];
r = await call("GET", `/api/plans/${pid}/alternatives?itemId=${item.id}`);
check("alternatives", r.status === 200 && Array.isArray(r.json?.alternatives), `${r.json?.alternatives?.length} options`);
const alts = r.json?.alternatives ?? [];

if (ineligible) {
  r = await call("PUT", `/api/plans/${pid}/items/${item.id}`, { courseId: ineligible.course_id, dryRun: true });
  check(`prereq re-check flags ${ineligible.code}`, r.status === 200 && r.json?.eligible === false && r.json?.blocking === true, `missing: ${(r.json?.missing || []).join(", ")}`);
  r = await call("PUT", `/api/plans/${pid}/items/${item.id}`, { courseId: ineligible.course_id, advisorId: 1 });
  check("swap to ineligible course is refused (422)", r.status === 422);
}

let swapped = false;
for (const a of alts) {
  if (a.courseId === item.courseId) continue;
  const dry = await call("PUT", `/api/plans/${pid}/items/${item.id}`, { courseId: a.courseId, dryRun: true });
  if (dry.json?.blocking) continue;
  r = await call("PUT", `/api/plans/${pid}/items/${item.id}`, { courseId: a.courseId, advisorId: 1, reason: "Smoke test swap" });
  check(`swap ${item.code} -> ${a.code}`, r.status === 200 && r.json?.plan?.status === "in_review" && r.json.items.some((i) => i.code === a.code));
  check("swap recorded in audit trail", r.json?.events?.some((e) => e.action === "swapped_course"));
  plan = r.json;
  swapped = true;
  break;
}
if (!swapped) console.log("WARN  no clean swap candidate found, skipped swap");

if (!plan.canApprove) {
  console.log("WARN  plan has blocking issues:", [...plan.items.flatMap((i) => i.issues), ...plan.issues].filter((i) => i.severity === "high").map((i) => i.message));
  r = await call("POST", `/api/plans/${pid}/approve`, { advisorId: 1 });
  check("approve is blocked (409)", r.status === 409);
} else {
  r = await call("POST", `/api/plans/${pid}/approve`, { advisorId: 1, note: "smoke test" });
  check("approve", r.status === 200 && r.json?.plan?.status === "approved" && r.json?.plan?.approvedBy, `by ${r.json?.plan?.approvedBy}`);
  check("approval in audit trail", r.json?.events?.some((e) => e.action === "approved"));
}

r = await call("GET", "/api/caseload?advisorId=1");
const s2 = r.json?.students?.find((s) => s.student_id === sid);
check("caseload shows the plan status", !!s2?.plan_status, s2?.plan_status);

r = await call("GET", "/api/demand");
check("demand", r.status === 200 && Array.isArray(r.json?.courses), `${r.json?.courses?.length} courses, ${r.json?.over} over capacity`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
