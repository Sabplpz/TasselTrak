import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pg, sql } from "./db";

const R = resolve(__dirname, "../../app/api");
let pass = 0, failN = 0;
const failures: string[] = [];
function check(name: string, cond: any, extra?: unknown) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { failN++; failures.push(name); console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra).slice(0, 400) : "")); }
}
const section = (s: string) => console.log("\n== " + s);

async function call(file: string, method: string, url: string, params: Record<string, string> = {}, body?: any) {
  const mod = await import(pathToFileURL(`${R}/${file}`).href);
  const req = new Request("http://x" + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await mod[method](req, { params: Promise.resolve(params) });
  return { status: res.status as number, body: (await res.json()) as any };
}
const cid = async (code: string) => ((await sql`SELECT id FROM courses WHERE code = ${code}`) as any[])[0].id as number;
const item = (plan: any, code: string) => plan.items.find((i: any) => i.code === code);

async function main() {
  // ---------------------------------------------------------------- database
  const m003 = readFileSync(resolve(__dirname, "../../migrations/003_figma_alignment.sql"), "utf8");
  for (const f of ["00_schema", "01_risk_and_stubs", "02_migration"]) await pg.exec(readFileSync(`${__dirname}/sql/${f}.sql`, "utf8"));
  await pg.exec(m003);
  await pg.exec(readFileSync(`${__dirname}/sql/04_seed.sql`, "utf8"));
  // migration 003 must be re-runnable
  await pg.exec(m003);
  console.log("schema + migrations 001-003 + seed loaded (003 ran twice)");

  const NORA = 1, PRIYA = 2, TYLER = 4;
  const AVERY = 1, MARCUS = 2;

  // ---------------------------------------------------------------- advisors + list
  section("advisors");
  let r = await call("advisors/route.ts", "GET", "/api/advisors");
  check("advisors include can_override", r.body.advisors.every((a: any) => typeof a.can_override === "boolean"), r.body);
  check("second advisor is not authorized to override", r.body.advisors.find((a: any) => a.name === "Marcus Okafor")?.can_override === false);

  section("advisor student list");
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/${AVERY}/students`, { advisorId: String(AVERY) });
  check("200", r.status === 200, r.body);
  const names = r.body.students.map((s: any) => s.display_name);
  check("sorted by risk, high to low, unscored last", JSON.stringify(names) === JSON.stringify(["Priya Shah", "Marcus Bell", "Nora Reyes", "Tyler Brooks"]), names);
  const priya = r.body.students[0], nora = r.body.students[2];
  check("risk is 0..100 and level uses the 60 cut-off", priya.risk_score === 78 && priya.risk_level === "high" && nora.risk_score === 12 && nora.risk_level === "low", [priya.risk_score, priya.risk_level]);
  check("gpa computed from grades (Nora 3.54)", nora.gpa === 3.54, nora.gpa);
  check("class standing + credits remaining + projected graduation", nora.class_standing === "Freshman" && nora.credits_remaining === 97 && nora.projected_graduation === "Spring 2029", nora);
  check("summary counts", r.body.summary.total === 4 && r.body.summary.high_risk === 2, r.body.summary);
  check("majors list", JSON.stringify(r.body.majors) === JSON.stringify(["Computer Science B.S.", "Information Technology B.S."]), r.body.majors);
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/${AVERY}/students?search=nor`, { advisorId: String(AVERY) });
  check("search by name", r.body.students.length === 1 && r.body.page.total === 1, r.body.page);
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/${AVERY}/students?major=${encodeURIComponent("Information Technology B.S.")}`, { advisorId: String(AVERY) });
  check("filter by major", r.body.students.length === 1 && r.body.students[0].display_name === "Marcus Bell");
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/${AVERY}/students?limit=2&offset=2&sort=name`, { advisorId: String(AVERY) });
  check("pagination + sort by name", r.body.students.length === 2 && r.body.students[0].display_name === "Priya Shah" && r.body.page.total === 4, r.body.students.map((s: any) => s.display_name));
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/99/students`, { advisorId: "99" });
  check("unknown advisor 404 with code", r.status === 404 && r.body.code === "advisor_not_found");

  // ---------------------------------------------------------------- risk panel
  section("risk panel");
  r = await call("students/[id]/risk/route.ts", "GET", `/api/students/${PRIYA}/risk`, { id: String(PRIYA) });
  check("ok status, 78, high", r.status === 200 && r.body.status === "ok" && r.body.risk_score === 78 && r.body.risk_level === "high", r.body);
  check("factors sorted by points with plain-language text", r.body.factors[0].key === "open_flags" && r.body.factors[0].points === 30 && /2 open flags/.test(r.body.factors[0].detail) && r.body.factors[1].key === "non_passing", r.body.factors);
  check("zero-contribution factors hidden", !r.body.factors.some((f: any) => f.key === "retakes"));
  check("summary sentence + advisory note", /Mainly driven by open advising flags and courses not passed yet\./.test(r.body.summary) && /Advisory only/.test(r.body.advisory_note), r.body.summary);
  check("pace factor wording", /9 credits earned against about 30 expected/.test(r.body.factors.find((f: any) => f.key === "pace_shortfall").detail));
  r = await call("students/[id]/risk/route.ts", "GET", `/api/students/${TYLER}/risk`, { id: String(TYLER) });
  check("no degree audit -> status no_audit", r.body.status === "no_audit" && r.body.risk_score === null, r.body);
  r = await call("students/[id]/risk/route.ts", "GET", `/api/students/99/risk`, { id: "99" });
  check("unknown student 404 with code", r.status === 404 && r.body.code === "student_not_found");

  // ---------------------------------------------------------------- generate
  section("plan: empty state + generate");
  r = await call("students/[id]/plan/route.ts", "GET", `/api/students/${NORA}/plan`, { id: String(NORA) });
  check("no plan yet -> 404 no_plan", r.status === 404 && r.body.code === "no_plan", r.body);
  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY });
  check("generate 201", r.status === 201, r.body);
  let plan = r.body;
  const spring = plan.items.filter((i: any) => i.termCode === "spring-2027").map((i: any) => i.code).sort();
  check("next term = the model's four courses", JSON.stringify(spring) === JSON.stringify(["CIS 3360", "COP 4331", "COP 4600", "COT 4210"]), spring);
  const fall27 = plan.items.filter((i: any) => i.termCode === "fall-2027").map((i: any) => i.code).sort();
  check("a second term is filled by rules (Fall 2027 incl. Senior Design I)", fall27.includes("COP 4934"), fall27);
  check("prerequisites respected: no Senior Design II, nothing needing a same-term prereq", !plan.items.some((i: any) => i.code === "COP 4935") && !item(plan, "COP 4934").issues.some((x: any) => x.type === "not_eligible"), fall27);
  check("Fall 2027 has no schedule, so no 'no_section' blocks", !plan.items.filter((i: any) => i.termCode === "fall-2027").some((i: any) => i.issues.some((x: any) => x.type === "no_section")));
  check("plan can be approved as generated", plan.canApprove === true && plan.blocking === 0, { blocking: plan.blocking, issues: plan.blockingIssues });
  check("board terms: history + planned with labels", JSON.stringify(plan.terms.map((t: any) => [t.code, t.label])) === JSON.stringify([["fall-2025","Completed"],["spring-2026","Completed"],["fall-2026","In progress"],["spring-2027","Up next"],["fall-2027","Later"]]), plan.terms.map((t: any) => [t.code, t.label]));
  check("credits under each header (10 / 13 / 9 / 12)", JSON.stringify(plan.terms.slice(0, 4).map((t: any) => t.credits)) === JSON.stringify([10, 13, 9, 12]), plan.terms.map((t: any) => t.credits));
  check("'Now' flag on the current term", plan.terms.find((t: any) => t.code === "fall-2026").now === true);
  check("history carries grades and in-progress", plan.history.find((h: any) => h.code === "COT 3100").grade === "A-" && plan.history.find((h: any) => h.code === "COP 3503").status === "in_progress");
  check("item status: needs / available / locked", item(plan, "COP 4331").status === "needs" && JSON.stringify(item(plan, "COP 4331").needs) === '["COP 3503"]' && item(plan, "COT 4210").status === "available" && item(plan, "COP 4934").status === "locked", [item(plan, "COP 4331").status, item(plan, "COP 4331").needs, item(plan, "COP 4934").status]);
  check("AI picks start as Suggested (unconfirmed)", item(plan, "COP 4331").suggested === true && item(plan, "COP 4331").confirmed === false);
  check("seat risk shown as medium (non-blocking)", item(plan, "COP 4600").issues.some((x: any) => x.type === "seat_risk" && x.severity === "medium"));
  check("rationale split into points", plan.plan.rationalePoints.length >= 3, plan.plan.rationalePoints);
  check("status is draft", plan.plan.status === "draft" && plan.readOnly === false);
  const planId = plan.plan.id;

  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY });
  check("generate again -> 409 plan_exists with the plan id", r.status === 409 && r.body.code === "plan_exists" && r.body.planId === planId, r.body);
  {
    const before = ((await sql`SELECT count(*)::int AS n FROM plans WHERE student_id = ${NORA}`) as any[])[0].n;
    const ac = new AbortController(); ac.abort();
    const mod = await import(pathToFileURL(`${R}/students/[id]/plan/generate/route.ts`).href);
    const res = await mod.POST(new Request("http://x/g", { method: "POST", signal: ac.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ advisorId: AVERY, replace: true }) }), { params: Promise.resolve({ id: String(NORA) }) });
    const after = ((await sql`SELECT count(*)::int AS n FROM plans WHERE student_id = ${NORA}`) as any[])[0].n;
    check("cancelled generate (aborted request) saves nothing", res.status === 499 && before === after, { status: res.status, before, after });
  }

  process.env.MOCK_LLM = "fail";
  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY, replace: true });
  check("model timeout -> 504 planner_timeout", r.status === 504 && r.body.code === "planner_timeout", r.body);
  r = await call("students/[id]/plan/route.ts", "GET", `/api/students/${NORA}/plan`, { id: String(NORA) });
  check("...and nothing changed (same plan, still draft)", r.body.plan.id === planId && r.body.plan.status === "draft");
  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY, replace: true, allowFallback: true });
  check("allowFallback still saves a rules draft", r.status === 201 && r.body.plan.modelName === "rules-fallback", r.body.plan?.modelName);
  r = await call("students/[id]/plan/route.ts", "POST", `/api/students/${NORA}/plan`, { id: String(NORA) }, { advisorId: AVERY });
  check("older POST /plan route keeps its fallback behaviour", r.status === 201 && r.body.plan.modelName === "rules-fallback");
  delete process.env.MOCK_LLM;

  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY, replace: true });
  check("replace:true writes a new draft", r.status === 201 && r.body.plan.modelName === "mock-model" && r.body.plan.id !== planId, r.body.plan);
  plan = r.body;
  const P = String(plan.plan.id);
  const live = (await sql`SELECT COUNT(*)::int AS n FROM plans WHERE student_id = ${NORA} AND status <> 'archived'`) as any[];
  check("only one live plan; older drafts archived", live[0].n === 1, live);

  // ---------------------------------------------------------------- picker
  section("add-course picker");
  const cnt4714 = await cid("CNT 4714");
  r = await call("plans/[id]/course-options/route.ts", "GET", `/api/plans/${P}/course-options?term=spring-2027`, { id: P });
  const grp = (b: any, name: string) => b.groups.find((g: any) => g.requirement === name);
  check("slots already used on the board are not offered again (elective + humanities)", !grp(r.body, "CS restricted elective") && !grp(r.body, "Humanities"), r.body.groups?.map((g: any) => g.requirement));
  check("courses already on the board are not offered", !r.body.groups.some((g: any) => g.courses.some((c: any) => c.code === "COP 4331")));
  const c4935 = grp(r.body, "core").courses.find((c: any) => c.code === "COP 4935");
  check("a course whose prerequisite is only planned LATER shows as not met", c4935.prerequisitesMet === false && JSON.stringify(c4935.missing) === '["COP 4934"]', c4935);
  // free the elective slot, then the group appears
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${cnt4714}?advisorId=${AVERY}`, { id: P, courseId: String(cnt4714) });
  check("remove the elective that rules chose", r.status === 200 && r.body.removed.code === "CNT 4714");
  r = await call("plans/[id]/course-options/route.ts", "GET", `/api/plans/${P}/course-options?term=spring-2027`, { id: P });
  check("elective group now offers its courses, prerequisites met", JSON.stringify(grp(r.body, "CS restricted elective")?.courses.map((c: any) => c.code).sort()) === '["CAP 4611","CAP 4630","CNT 4714","COP 4020"]' && grp(r.body, "CS restricted elective").courses.every((c: any) => c.prerequisitesMet), grp(r.body, "CS restricted elective"));
  r = await call("plans/[id]/course-options/route.ts", "GET", `/api/plans/${P}/course-options?term=fall-2026`, { id: P });
  const ai = grp(r.body, "CS restricted elective").courses.find((c: any) => c.code === "CAP 4630");
  check("current-term picker: CAP 4630 needs COP 3503 (still in progress)", ai.prerequisitesMet === false && JSON.stringify(ai.missing) === '["COP 3503"]', ai);
  check("term open flag is false for the current term", r.body.term.open === false);
  r = await call("plans/[id]/course-options/route.ts", "GET", `/api/plans/${P}/course-options?term=spring-2027&search=machine`, { id: P });
  check("search filters by title", r.body.groups.length === 1 && r.body.groups[0].courses.length === 1 && r.body.groups[0].courses[0].code === "CAP 4611", r.body.groups);
  r = await call("plans/[id]/course-options/route.ts", "GET", `/api/plans/${P}/course-options?term=nope`, { id: P });
  check("unknown term -> 400 term_not_found", r.status === 400 && r.body.code === "term_not_found");

  // ---------------------------------------------------------------- add / move
  section("add course");
  const ai4630 = await cid("CAP 4630"), cop4710 = await cid("COP 4710"), cop4331 = await cid("COP 4331"), cap4611 = await cid("CAP 4611");
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4331, termCode: "fall-2026", advisorId: AVERY });
  check("COP 4331 is already on the plan -> 422", r.status === 422 && r.body.code === "check_failed");
  // take COP 4331 off first to reproduce the Figma error exactly
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${cop4331}?advisorId=${AVERY}`, { id: P, courseId: String(cop4331) });
  check("remove COP 4331 (200, snapshot kept)", r.status === 200 && r.body.removed.code === "COP 4331");
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4331, termCode: "fall-2026", advisorId: AVERY });
  check("Figma A4: COP 4331 into Fall 2026 -> 422", r.status === 422 && r.body.code === "check_failed", r.body);
  check("...blocking course is COP 3503, being taken this term", r.body.blockingCourse?.code === "COP 3503" && r.body.blockingCourse?.inProgress === true, r.body.blockingCourse);
  check("...earliest allowed term suggested: Spring 2027", r.body.suggestedTerm?.code === "spring-2027", r.body.suggestedTerm);
  check("...message names the prerequisite", r.body.problems.some((p: any) => p.type === "not_eligible" && /needs COP 3503 first/.test(p.message)), r.body.problems);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4331, termCode: "fall-2026", advisorId: AVERY, dryRun: true });
  check("dryRun reports the same without adding", r.status === 200 && r.body.dryRun === true && r.body.blocking === true);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4331, termCode: "spring-2027", advisorId: AVERY });
  check("COP 4331 into Spring 2027 -> 201 + added", r.status === 201 && r.body.added.code === "COP 4331", r.body.problems ?? r.body);
  check("advisor-added course is confirmed (not 'Suggested')", item(r.body, "COP 4331").suggested === false && item(r.body, "COP 4331").source === "advisor");
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4710, termCode: "spring-2027", advisorId: AVERY });
  check("already on the plan (Fall 2027) -> 422 duplicate", r.status === 422 && r.body.problems.some((p: any) => /already in this plan/.test(p.message)), r.body.problems);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${cop4710}?advisorId=${AVERY}`, { id: P, courseId: String(cop4710) });
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4710, termCode: "spring-2027", advisorId: AVERY });
  check("time clash with COP 4600 -> 422", r.status === 422 && r.body.problems.some((p: any) => p.type === "time_conflict"), r.body);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4710, termCode: "spring-2027", advisorId: MARCUS, force: true, note: "needed" });
  check("force by an unauthorized advisor -> 403", r.status === 403 && r.body.code === "not_authorized", r.body);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4710, termCode: "spring-2027", advisorId: AVERY, force: true, note: "Only section that fits her schedule." });
  check("force by an authorized advisor -> 201 with an Override tag", r.status === 201 && item(r.body, "COP 4710").override?.advisorName === "Dr. Avery Dunn" && item(r.body, "COP 4710").override?.note === "Only section that fits her schedule.", item(r.body, "COP 4710"));
  check("...the overridden problem no longer blocks approval", r.body.canApprove === true && r.body.totals.overrides === 1, { blocking: r.body.blocking, totals: r.body.totals });
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: 9999, advisorId: AVERY });
  check("unknown course -> 404 course_not_found", r.status === 404 && r.body.code === "course_not_found");

  section("move course");
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${ai4630}`, { id: P, courseId: String(ai4630) }, { termCode: "spring-2027", advisorId: AVERY });
  check("CAP 4630 not on the plan yet -> 404 item_not_found", r.status === 404 && r.body.code === "item_not_found");
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: ai4630, termCode: "spring-2027", advisorId: AVERY });
  check("add CAP 4630 to Spring 2027", r.status === 201);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${ai4630}`, { id: P, courseId: String(ai4630) }, { termCode: "fall-2027", advisorId: AVERY });
  check("move CAP 4630 to Fall 2027 -> 200", r.status === 200 && item(r.body, "CAP 4630").termCode === "fall-2027" && r.body.moved.to === "fall-2027", r.body.problems ?? r.body.moved);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${cop4331}`, { id: P, courseId: String(cop4331) }, { termCode: "fall-2026", advisorId: AVERY });
  check("move COP 4331 into the current term -> 422 with 'Move to Spring 2027' hint", r.status === 422 && r.body.suggestedTerm?.code === "spring-2027", r.body);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${cop4331}`, { id: P, courseId: String(cop4331) }, { termCode: "fall-2027", advisorId: AVERY });
  check("moving a prerequisite later flags the course that depends on it", r.status === 200 && item(r.body, "COP 4934").issues.some((x: any) => x.type === "not_eligible") && r.body.canApprove === false, { blocking: r.body.blocking });
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${cop4331}`, { id: P, courseId: String(cop4331) }, { termCode: "spring-2027", advisorId: AVERY });
  check("...and moving it back clears that", r.status === 200 && item(r.body, "COP 4934").issues.every((x: any) => x.type !== "not_eligible"));

  // ---------------------------------------------------------------- confirm / swap / alternatives
  section("confirm, alternatives, swap");
  r = await call("plans/[id]/courses/[courseId]/confirm/route.ts", "POST", `/api/plans/${P}/courses/${await cid("COT 4210")}/confirm`, { id: P, courseId: String(await cid("COT 4210")) }, { advisorId: AVERY });
  check("confirm clears 'Suggested'", r.status === 200 && item(r.body, "COT 4210").suggested === false && item(r.body, "COT 4210").confirmed === true);
  r = await call("plans/[id]/courses/[courseId]/alternatives/route.ts", "GET", `/api/plans/${P}/courses/${ai4630}/alternatives`, { id: P, courseId: String(ai4630) });
  const alt = r.body.alternatives?.map((a: any) => a.code) ?? [];
  check("alternatives for CAP 4630 (Fall 2027) list the other electives, not itself", alt.includes("CAP 4611") && alt.includes("COP 4020") && alt.includes("CNT 4714") && !alt.includes("CAP 4630"), alt);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PUT", `/api/plans/${P}/courses/${ai4630}`, { id: P, courseId: String(ai4630) }, { newCourseId: cap4611, advisorId: AVERY, dryRun: true });
  check("swap dryRun", r.status === 200 && r.body.dryRun === true && r.body.replaces === "CAP 4630", r.body);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PUT", `/api/plans/${P}/courses/${ai4630}`, { id: P, courseId: String(ai4630) }, { newCourseId: cap4611, advisorId: AVERY });
  check("swap CAP 4630 -> CAP 4611 keeps the term", r.status === 200 && item(r.body, "CAP 4611")?.termCode === "fall-2027" && !item(r.body, "CAP 4630"), r.body.problems ?? r.body.items?.map((i: any) => i.code));

  // ---------------------------------------------------------------- remove / undo
  section("remove + undo");
  r = await call("plans/[id]/courses/[courseId]/dependents/route.ts", "GET", `/api/plans/${P}/courses/${cop4331}/dependents`, { id: P, courseId: String(cop4331) });
  check("remove confirm lists COP 4934 as affected (direct)", r.status === 200 && r.body.dependents.length === 1 && r.body.dependents[0].code === "COP 4934" && r.body.dependents[0].direct === true, r.body);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${cop4331}?advisorId=${AVERY}`, { id: P, courseId: String(cop4331) });
  check("remove -> COP 4934 now has a problem", r.status === 200 && item(r.body, "COP 4934").issues.some((x: any) => x.type === "not_eligible") && r.body.blocking >= 1, r.body.blocking);
  r = await call("plans/[id]/courses/[courseId]/restore/route.ts", "POST", `/api/plans/${P}/courses/${cop4331}/restore`, { id: P, courseId: String(cop4331) }, { advisorId: AVERY });
  check("undo restores it in the same term with its reason", r.status === 200 && item(r.body, "COP 4331")?.termCode === "spring-2027" && item(r.body, "COP 4331").reason === "Added by advisor." && r.body.blocking === 0, r.body.items?.map((i: any) => i.code + ":" + i.termCode));
  r = await call("plans/[id]/courses/[courseId]/restore/route.ts", "POST", `/api/plans/${P}/courses/${cop4331}/restore`, { id: P, courseId: String(cop4331) }, { advisorId: AVERY });
  check("a second undo has nothing to restore", r.status === 404 && r.body.code === "nothing_to_restore", r.body);

  // ---------------------------------------------------------------- approval + override
  section("approval blocked -> override -> approved");
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${cop4331}?advisorId=${AVERY}`, { id: P, courseId: String(cop4331) });
  const c4934 = await cid("COP 4934");
  r = await call("plans/[id]/approve/route.ts", "POST", `/api/plans/${P}/approve`, { id: P }, { advisorId: AVERY });
  check("approve with problems -> 409 blocking_issues + checklist", r.status === 409 && r.body.code === "blocking_issues" && r.body.blocking === 1 && r.body.issues[0].courseId === c4934, r.body);
  r = await call("plans/[id]/courses/[courseId]/override/route.ts", "POST", `/api/plans/${P}/courses/${c4934}/override`, { id: P, courseId: String(c4934) }, { advisorId: MARCUS, note: "x" });
  check("override by an unauthorized advisor -> 403", r.status === 403 && r.body.code === "not_authorized");
  r = await call("plans/[id]/courses/[courseId]/override/route.ts", "POST", `/api/plans/${P}/courses/${c4934}/override`, { id: P, courseId: String(c4934) }, { advisorId: AVERY });
  check("override without a reason -> 400 note_required", r.status === 400 && r.body.code === "note_required");
  r = await call("plans/[id]/courses/[courseId]/override/route.ts", "POST", `/api/plans/${P}/courses/${cop4331}/override`, { id: P, courseId: String(cop4331) }, { advisorId: AVERY, note: "x" });
  check("override on a course that is not on the plan -> 404", r.status === 404);
  r = await call("plans/[id]/courses/[courseId]/override/route.ts", "POST", `/api/plans/${P}/courses/${await cid("COT 4210")}/override`, { id: P, courseId: String(await cid("COT 4210")) }, { advisorId: AVERY, note: "x" });
  check("override where there is nothing to override -> 409", r.status === 409 && r.body.code === "nothing_to_override");
  r = await call("plans/[id]/courses/[courseId]/override/route.ts", "POST", `/api/plans/${P}/courses/${c4934}/override`, { id: P, courseId: String(c4934) }, { advisorId: AVERY, note: "Department approved the sequence change." });
  check("override recorded: tag text + author", r.status === 200 && item(r.body, "COP 4934").override?.advisorName === "Dr. Avery Dunn" && /Department approved/.test(item(r.body, "COP 4934").override.note), item(r.body, "COP 4934")?.override);
  check("...blocking drops to 0, plan can be approved", r.body.blocking === 0 && r.body.canApprove === true && r.body.totals.overrides >= 1);
  r = await call("plans/[id]/approve/route.ts", "POST", `/api/plans/${P}/approve`, { id: P }, { advisorId: AVERY });
  check("approve -> 200, read-only, approver named", r.status === 200 && r.body.plan.status === "approved" && r.body.readOnly === true && r.body.plan.approvedBy === "Dr. Avery Dunn", r.body.plan);
  r = await call("plans/[id]/approve/route.ts", "POST", `/api/plans/${P}/approve`, { id: P }, { advisorId: AVERY });
  check("approving twice -> 409 already_approved", r.status === 409 && r.body.code === "already_approved");

  section("read-only + status flow");
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: cop4331, termCode: "spring-2027", advisorId: AVERY });
  check("add on an approved plan -> 409 read_only", r.status === 409 && r.body.code === "read_only");
  r = await call("plans/[id]/courses/[courseId]/route.ts", "DELETE", `/api/plans/${P}/courses/${c4934}`, { id: P, courseId: String(c4934) });
  check("remove on an approved plan -> 409 read_only", r.status === 409 && r.body.code === "read_only");
  r = await call("plans/[id]/route.ts", "PATCH", `/api/plans/${P}`, { id: P }, { name: "x" });
  check("rename on an approved plan -> 409 read_only", r.status === 409 && r.body.code === "read_only");
  r = await call("plans/[id]/items/route.ts", "POST", `/api/plans/${P}/items`, { id: P }, { courseId: cop4331 });
  check("older /items route is also read-only", r.status === 409 && r.body.code === "read_only");
  r = await call("students/[id]/plan/generate/route.ts", "POST", `/api/students/${NORA}/plan/generate`, { id: String(NORA) }, { advisorId: AVERY, replace: true });
  check("generate over an approved plan -> 409 plan_approved", r.status === 409 && r.body.code === "plan_approved");
  r = await call("plans/[id]/submit-review/route.ts", "POST", `/api/plans/${P}/submit-review`, { id: P }, { advisorId: AVERY });
  check("submit-review needs a draft -> 409 invalid_status", r.status === 409 && r.body.code === "invalid_status");
  r = await call("plans/[id]/reopen/route.ts", "POST", `/api/plans/${P}/reopen`, { id: P }, { advisorId: AVERY });
  check("reopen -> draft, editable, approval cleared", r.status === 200 && r.body.plan.status === "draft" && r.body.readOnly === false && r.body.plan.approvedBy === null, r.body.plan);
  r = await call("plans/[id]/submit-review/route.ts", "POST", `/api/plans/${P}/submit-review`, { id: P }, { advisorId: AVERY });
  check("submit-review -> in_review with a timestamp", r.status === 200 && r.body.plan.status === "in_review" && !!r.body.plan.submittedAt, r.body.plan);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PUT", `/api/plans/${P}/courses/${await cid("CIS 3360")}`, { id: P, courseId: String(await cid("CIS 3360")) }, { newCourseId: await cid("COP 4020"), advisorId: AVERY });
  check("editing a plan in review sends it back to draft", r.status === 200 && r.body.plan.status === "draft" && r.body.plan.submittedAt === null, r.body.problems ?? r.body.plan);
  r = await call("plans/[id]/submit-review/route.ts", "POST", `/api/plans/${P}/submit-review`, { id: P }, { advisorId: AVERY });
  r = await call("plans/[id]/back-to-draft/route.ts", "POST", `/api/plans/${P}/back-to-draft`, { id: P }, { advisorId: AVERY });
  check("back-to-draft from in_review", r.status === 200 && r.body.plan.status === "draft");
  r = await call("plans/[id]/back-to-draft/route.ts", "POST", `/api/plans/${P}/back-to-draft`, { id: P }, { advisorId: AVERY });
  check("back-to-draft from a draft -> 409", r.status === 409 && r.body.code === "invalid_status");
  r = await call("plans/[id]/route.ts", "GET", `/api/plans/${P}`, { id: P });
  check("audit trail has the whole story", ["generated", "added_course", "moved_course", "removed_course", "restored_course", "override", "approved", "reopened", "submitted_for_review", "back_to_draft"].every((a) => r.body.events.some((e: any) => e.action === a)), [...new Set(r.body.events.map((e: any) => e.action))]);

  // ---------------------------------------------------------------- demand
  section("seat demand");
  r = await call("demand/route.ts", "GET", `/api/demand?term=spring-2027`);
  check("courses + term picker list", r.status === 200 && r.body.courses.length > 0 && r.body.terms.some((t: any) => t.code === "fall-2027") && r.body.terms.some((t: any) => t.code === "spring-2027"), r.body.terms);
  check("planned students counted", r.body.courses.find((c: any) => c.code === "COT 4210")?.planned_students === 1, r.body.courses.map((c: any) => [c.code, c.planned_students]));
  check("seats_total + status present", r.body.courses.every((c: any) => typeof c.seats_total === "number" && ["over", "tight", "ok"].includes(c.status)));
  r = await call("demand/route.ts", "GET", `/api/demand?term=spring-2027&limit=2&offset=1`);
  check("pagination", r.body.courses.length === 2 && r.body.page.offset === 1 && r.body.page.total >= 5, r.body.page);
  r = await call("demand/route.ts", "GET", `/api/demand?term=nope`);
  check("unknown term -> 404", r.status === 404 && r.body.code === "term_not_found");
  r = await call("demand/[courseId]/students/route.ts", "GET", `/api/demand/${await cid("COT 4210")}/students?term=spring-2027`, { courseId: String(await cid("COT 4210")) });
  check("students who planned the course", r.status === 200 && r.body.total === 1 && r.body.students[0].display_name === "Nora Reyes" && r.body.students[0].plan_status === "draft", r.body);

  // ---------------------------------------------------------------- remind + older routes
  section("remind + older routes");
  r = await call("students/[id]/remind/route.ts", "POST", `/api/students/${TYLER}/remind`, { id: String(TYLER) }, { advisorId: AVERY });
  const notes = (await sql`SELECT body FROM advisor_notes WHERE student_id = ${TYLER}`) as any[];
  check("remind records a note and says nothing was delivered", r.status === 201 && r.body.recorded === true && r.body.delivered === false && notes.length === 1, r.body);
  r = await call("caseload/route.ts", "GET", `/api/caseload?advisorId=${AVERY}`);
  check("GET /api/caseload still works", r.status === 200 && r.body.students.length === 4);
  r = await call("students/[id]/route.ts", "GET", `/api/students/${NORA}`, { id: String(NORA) });
  check("GET /api/students/:id still works", r.status === 200 && r.body.remaining.length > 0 && r.body.risk?.risk_level === "low");
  r = await call("plans/[id]/alternatives/route.ts", "GET", `/api/plans/${P}/alternatives?itemId=${(await call("plans/[id]/route.ts", "GET", `/api/plans/${P}`, { id: P })).body.items[0].id}`, { id: P });
  check("GET /alternatives?itemId= still works", r.status === 200 && Array.isArray(r.body.alternatives));

  section("remove confirmation: knock-on effects");
  r = await call("plans/[id]/courses/[courseId]/restore/route.ts", "POST", `/api/plans/${P}/courses/${cop4331}/restore`, { id: P, courseId: String(cop4331) }, { advisorId: AVERY });
  check("restore COP 4331 again", r.status === 200 && !!item(r.body, "COP 4331"), r.body);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${P}/courses`, { id: P }, { courseId: await cid("COP 4935"), termCode: "spring-2028", advisorId: AVERY });
  check("Senior Design II into Spring 2028 (after Senior Design I)", r.status === 201, r.body.problems);
  r = await call("plans/[id]/courses/[courseId]/dependents/route.ts", "GET", `/api/plans/${P}/courses/${cop4331}/dependents`, { id: P, courseId: String(cop4331) });
  check("removing COP 4331 affects COP 4934 (direct) and COP 4935 (knock-on)", JSON.stringify(r.body.dependents.map((x: any) => [x.code, x.direct])) === '[["COP 4934",true],["COP 4935",false]]', r.body.dependents);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${await cid("COP 4935")}`, { id: P, courseId: String(await cid("COP 4935")) }, { termCode: "fall-2027", advisorId: AVERY });
  check("Senior Design II in the same term as Senior Design I -> 422, suggests Spring 2028", r.status === 422 && r.body.blockingCourse?.code === "COP 4934" && r.body.suggestedTerm?.code === "spring-2028", r.body);

  // ---------------------------------------------------------------- pregenerate
  process.env.ADMIN_SECRET = "s";
  r = await call("admin/pregenerate/route.ts", "POST", `/api/admin/pregenerate?secret=s&limit=1`);
  check("pregenerate runs (rules fallback allowed)", r.status === 200 && Array.isArray(r.body.generated), r.body);
  r = await call("admin/pregenerate/route.ts", "POST", `/api/admin/pregenerate?secret=bad`);
  check("pregenerate still needs the secret", r.status === 403);

  console.log(`\n${pass} passed, ${failN} failed`);
  if (failN) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(2); });
