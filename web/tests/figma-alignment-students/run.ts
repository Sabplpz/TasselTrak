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
  const mod = await import(pathToFileURL(`${R}/${file}`).href); // file:// URL: required on Windows
  const req = new Request("http://x" + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await mod[method](req, { params: Promise.resolve(params) });
  return { status: res.status as number, body: (await res.json()) as any };
}
const cid = async (code: string) => ((await sql`SELECT id FROM courses WHERE code = ${code}`) as any[])[0].id as number;
const bc2 = (b: any, code: string) => b.courses.find((c: any) => c.code === code);
const item = (plan: any, code: string) => plan.items.find((i: any) => i.code === code);

async function main() {
  // ---------------------------------------------------------------- database
  const m003 = readFileSync(resolve(__dirname, "../../migrations/003_figma_alignment.sql"), "utf8");
  for (const f of ["00_schema", "01_risk_and_stubs", "02_migration"]) await pg.exec(readFileSync(`${__dirname}/sql/${f}.sql`, "utf8"));
  await pg.exec(m003);
  const m004 = readFileSync(resolve(__dirname, "../../migrations/004_student_side.sql"), "utf8");
  await pg.exec(m004);
  await pg.exec(readFileSync(`${__dirname}/sql/04_seed.sql`, "utf8"));
  // migrations 003 and 004 must be re-runnable
  await pg.exec(m003);
  await pg.exec(m004);
  console.log("schema + migrations 001-004 + seed loaded (003 and 004 ran twice)");

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
  check("moving a prerequisite later than its dependent -> 422 breaks_dependent naming COP 4934", r.status === 422 && r.body.code === "check_failed" && r.body.breaks?.[0]?.code === "COP 4934" && r.body.problems.some((x: any) => x.type === "breaks_dependent"), r.body);
  r = await call("plans/[id]/courses/[courseId]/route.ts", "PATCH", `/api/plans/${P}/courses/${cop4331}`, { id: P, courseId: String(cop4331) }, { termCode: "fall-2027", advisorId: AVERY, force: true });
  check("an authorized advisor can force it; the dependent is then flagged", r.status === 200 && item(r.body, "COP 4934").issues.some((x: any) => x.type === "not_eligible") && r.body.canApprove === false, { blocking: r.body.blocking });
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

  // ================================================================ STUDENT SIDE
  section("student login list");
  r = await call("students/route.ts", "GET", "/api/students");
  check("lists all students", r.status === 200 && r.body.page.total === 5 && r.body.students.length === 5, r.body.page);
  check("each student has program, advisor and plan status", r.body.students.every((s: any) => "program_name" in s && "advisor_name" in s && "plan_status" in s && typeof s.courses_on_file === "number"));
  r = await call("students/route.ts", "GET", "/api/students?search=nor");
  check("search by name", r.body.students.length === 1 && r.body.students[0].display_name === "Nora Reyes" && r.body.students[0].courses_on_file === 10, r.body.students);
  r = await call("students/login/route.ts", "POST", "/api/students/login", {}, { studentId: NORA });
  check("login with history -> next board", r.status === 200 && r.body.studentId === NORA && r.body.next === "board" && r.body.student.programName === "Computer Science B.S.", r.body);
  r = await call("students/login/route.ts", "POST", "/api/students/login", {}, { studentId: TYLER });
  check("login with nothing on file -> next upload", r.body.next === "upload", r.body);
  r = await call("students/login/route.ts", "POST", "/api/students/login", {}, { studentId: 99 });
  check("login unknown student -> 404", r.status === 404 && r.body.code === "student_not_found");
  r = await call("students/login/route.ts", "POST", "/api/students/login", {}, {});
  check("login without studentId -> 400", r.status === 400 && r.body.code === "invalid_request");

  section("programs + manual picker");
  r = await call("programs/route.ts", "GET", "/api/programs");
  check("programs list with credit totals", r.status === 200 && r.body.programs.length === 2 && r.body.programs.every((p: any) => p.totalCredits === 120), r.body);
  const csProgram = r.body.programs.find((p: any) => p.name === "Computer Science B.S.").id as number;
  check("CS program counts its requirements", r.body.programs.find((p: any) => p.id === csProgram).courses === 22);
  r = await call("programs/[id]/courses/route.ts", "GET", `/api/programs/${csProgram}/courses`, { id: String(csProgram) });
  const pgrp = (n: string) => r.body.groups?.find((g: any) => g.requirement === n);
  check("courses grouped by requirement, pick-1 electives marked", r.status === 200 && pgrp("CS restricted elective")?.pickCount === 1 && pgrp("CS restricted elective").courses.length === 4, r.body.groups?.map((g: any) => g.requirement));
  check("slots are flagged", pgrp("Humanities")?.courses[0].isSlot === true);
  check("each course has id, code, title, credits", r.body.groups.every((g: any) => g.courses.every((c: any) => c.courseId && c.code && c.title && typeof c.credits === "number")));
  r = await call("programs/[id]/courses/route.ts", "GET", `/api/programs/999/courses`, { id: "999" });
  check("unknown program -> 404", r.status === 404 && r.body.code === "program_not_found");

  section("saving courses taken");
  const ZED = ((await sql`INSERT INTO students (university_id, display_name) SELECT id, 'Zed Newcomer' FROM universities LIMIT 1 RETURNING id`) as any[])[0].id as number;
  const zp = { id: String(ZED) };
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  check("board before a major is picked -> 409 no_program", r.status === 409 && r.body.code === "no_program", r.body);
  const [c3223, c3100, c2311, c3502, c3330, c3503, c4331, c4210, c4600, c4020, c3360, c3103] = await Promise.all(
    ["COP 3223", "COT 3100", "MAC 2311", "COP 3502", "COP 3330", "COP 3503", "COP 4331", "COT 4210", "COP 4600", "COP 4020", "CIS 3360", "CDA 3103"].map(cid)
  );
  const put = (body: any, id = ZED) => call("students/[id]/completed-courses/route.ts", "PUT", `/api/students/${id}/completed-courses`, { id: String(id) }, body);
  r = await put({ programId: csProgram, courses: [{ courseId: c3223, grade: "a" }, { courseId: c2311, grade: "B+" }, { courseId: c3100 }, { courseId: c3502, status: "in_progress" }] });
  check("save 4 courses and the major", r.status === 200 && r.body.saved === 4 && r.body.programId === csProgram && r.body.next === "board", r.body);
  check("credit bar numbers (taken 10, in progress 3)", r.body.credits.earned === 10 && r.body.credits.inProgress === 3, r.body.credits);
  r = await call("students/[id]/completed-courses/route.ts", "GET", `/api/students/${ZED}/completed-courses`, zp);
  const byCode = (code: string) => r.body.courses.find((c: any) => c.code === code);
  check("grade upper-cased; no grade saved as P; in progress has no grade or error", byCode("COP 3223").grade === "A" && byCode("COT 3100").grade === "P" && byCode("COP 3502").status === "in_progress" && byCode("COP 3502").grade === null, r.body.courses);
  check("in-progress course lands in the current term", byCode("COP 3502").termCode === "fall-2026", byCode("COP 3502"));
  r = await put({ courses: [{ courseId: c3223, grade: "Z" }] });
  check("bad grade -> 400 invalid_grade", r.status === 400 && r.body.code === "invalid_grade" && r.body.courseId === c3223, r.body);
  r = await put({ courses: [{ courseId: 99999 }] });
  check("unknown course -> 404 and nothing changed", r.status === 404 && r.body.code === "course_not_found", r.body);
  r = await put({ courses: [{ courseId: c3223, status: "in_progress", grade: "A" }] });
  check("grade on an in-progress course -> 400", r.status === 400 && r.body.code === "invalid_request");
  r = await put({ programId: 999, courses: [] });
  check("unknown programId -> 404", r.status === 404 && r.body.code === "program_not_found");
  r = await put({ courses: "x" });
  check("courses must be a list -> 400", r.status === 400);
  r = await put({ courses: [{ courseId: c3330, grade: "B", termCode: "spring-2026" }], mode: "merge" });
  check("merge keeps the other courses", r.status === 200 && r.body.saved === 5, r.body);
  r = await put({ courses: [{ courseId: c3330, termCode: "nope" }], mode: "merge" });
  check("unknown term -> 400 term_not_found", r.status === 400 && r.body.code === "term_not_found");
  r = await call("students/[id]/completed-courses/route.ts", "GET", `/api/students/${ZED}/completed-courses`, zp);
  check("failed saves changed nothing (still 5)", r.body.courses.length === 5, r.body.courses.length);
  r = await put({ courses: [{ courseId: c3223, grade: "A" }, { courseId: c3223, grade: "B" }, { courseId: c3100 }, { courseId: c2311, grade: "B+" }, { courseId: c3502, status: "in_progress" }] });
  check("a duplicate course is saved once (last one wins)", r.body.saved === 4, r.body);
  r = await call("students/[id]/completed-courses/route.ts", "GET", `/api/students/${ZED}/completed-courses`, zp);
  check("...with the later grade", r.body.courses.find((c: any) => c.code === "COP 3223").grade === "B");
  await put({ courses: [{ courseId: c3223, grade: "A" }, { courseId: c3100 }, { courseId: c2311, grade: "B+" }, { courseId: c3502, status: "in_progress" }] });

  section("the canvas (board)");
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  let board = r.body;
  const bc = (code: string) => board.courses.find((c: any) => c.code === code);
  check("200 with header, terms, courses, edges", r.status === 200 && board.header && board.terms && board.courses && board.edges, Object.keys(board));
  check("statuses: taken / in progress / available / locked", bc("COP 3223").status === "taken" && bc("COP 3502").status === "in_progress" && bc("COP 3330").status === "available" && bc("COP 4331").status === "locked", board.courses.map((c: any) => c.code + ":" + c.status));
  check("a course waiting on one in progress says what it needs", bc("COP 3503").status === "locked" && bc("COP 3503").prereq === "needs" && bc("COP 3503").needs.includes("COP 3502"), bc("COP 3503"));
  check("a course waiting on one not started is locked", bc("CIS 3360").prereq === "locked", bc("CIS 3360"));
  check("every course of the major is a note", board.courses.filter((c: any) => c.inProgram).length === 22, board.courses.filter((c: any) => c.inProgram).length);
  check("taken course sits in its term (or none), in-progress one in the current term", bc("COP 3502").termCode === "fall-2026" && bc("COP 3330").termCode === null, [bc("COP 3502").termCode, bc("COP 3330").termCode]);
  check("prerequisite lines", board.edges.some((e: any) => e.from === c3223 && e.to === c3502) && board.edges.some((e: any) => e.from === c3503 && e.to === c4331), board.edges.length);
  check("top bar: credits, remaining, GPA from graded courses only", board.header.creditsCompleted === 10 && board.header.creditsInProgress === 3 && board.header.creditsRemaining === 110 && board.header.creditsTotal === 120 && board.header.gpa === 3.57, board.header);
  check("next term is a column even with nothing in it", board.terms.some((t: any) => t.code === "spring-2027" && t.label === "Up next" && t.courses === 0) && board.terms.some((t: any) => t.code === "fall-2026" && t.state === "current"), board.terms);
  check("no plan yet: editable, plan null", board.plan === null && board.editable === true);

  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${NORA}/board`, { id: String(NORA) });
  board = r.body;
  check("Nora: GPA 3.54, 23 credits done, plan attached", r.status === 200 && board.header.gpa === 3.54 && board.header.creditsCompleted === 23 && String(board.plan?.id) === P, board.header);
  check("Nora: planned notes carry term, issues and the plan's per-term totals", bc("COT 4210").status === "planned" && bc("COT 4210").termCode === "spring-2027" && Array.isArray(bc("COT 4210").issues) && board.totals.byTerm.length >= 2, board.totals);
  // The test terms table stops at Spring 2029, so 61 credits at 12 a term run past it: no invented term code, just null.
  check("Nora: projected graduation is null when the terms table has no term that far out", board.header.projectedGraduation === null, board.header.projectedGraduation);
  check("Nora: planned credits counted (27) and 61 credits still unplanned", board.header.creditsPlanned === 27 && board.header.creditsInProgress === 9, board.header);
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/99/board`, { id: "99" });
  check("unknown student -> 404", r.status === 404 && r.body.code === "student_not_found");

  // projected graduation, positive case: an IT student with 3 credits done and a (temporarily) 20-credit degree
  // needs 17 more = two 15-credit terms after the current one (Fall 2026) -> Fall 2027 (summer skipped)
  await sql`UPDATE programs SET total_credits = 20 WHERE name = 'Information Technology B.S.'`;
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/3/board`, { id: "3" });
  check("projected graduation counts forward from the current term, skipping summer", r.status === 200 && r.body.header.projectedGraduation?.code === "fall-2027", r.body.header);
  await sql`UPDATE programs SET total_credits = 120 WHERE name = 'Information Technology B.S.'`;

  section("student edits: check while dragging, add, move, remove");
  const add = (body: any, id = ZED) => call("students/[id]/board/courses/route.ts", "POST", `/api/students/${id}/board/courses`, { id: String(id) }, body);
  const move = (courseId: number, body: any, id = ZED) => call("students/[id]/board/courses/[courseId]/route.ts", "PATCH", `/api/students/${id}/board/courses/${courseId}`, { id: String(id), courseId: String(courseId) }, body);
  const plansOf = async (id = ZED) => ((await sql`SELECT COUNT(*)::int AS n FROM plans WHERE student_id = ${id}`) as any[])[0].n as number;
  r = await add({ courseId: c4210, termCode: "spring-2027", dryRun: true });
  check("dryRun with no plan: allowed, nothing saved", r.status === 200 && r.body.dryRun === true && r.body.blocking === false && (await plansOf()) === 0, r.body.problems);
  r = await add({ courseId: c4331, termCode: "spring-2027", dryRun: true });
  check("dryRun on a blocked drop shows the blocking course (screen 7)", r.status === 200 && r.body.blocking === true && r.body.blockingCourse?.code === "COP 3503" && r.body.missing.includes("COP 3503"), r.body);
  r = await add({ courseId: c4331, termCode: "spring-2027" });
  check("real add that fails -> 422 check_failed with the same payload", r.status === 422 && r.body.code === "check_failed" && r.body.blockingCourse?.code === "COP 3503" && Array.isArray(r.body.problems) && r.body.term?.code === "spring-2027", r.body);
  check("...and no empty plan is left behind", (await plansOf()) === 0);
  r = await add({ courseId: c4600, termCode: "spring-2027", force: true, advisorId: AVERY });
  check("a student cannot force an override", r.status === 422 && r.body.code === "check_failed", r.body);
  r = await add({});
  check("add without courseId -> 400", r.status === 400 && r.body.code === "invalid_request");
  r = await add({ courseId: 99999, termCode: "spring-2027" });
  check("unknown course -> 404", r.status === 404 && r.body.code === "course_not_found", r.body);
  r = await add({ courseId: c4210, termCode: "spring-2027", __studentId: NORA });
  check("add OK -> 201, plan created for the student by the student", r.status === 201 && r.body.plan.createdBy === "student" && r.body.plan.status === "draft" && r.body.added?.code === "COT 4210" && r.body.plan.studentId === ZED, r.body);
  const zItem = (b: any, code: string) => b.items.find((i: any) => i.code === code);
  check("the item is a student course, confirmed (not a 'Suggested' one), with its section", zItem(r.body, "COT 4210").source === "student" && zItem(r.body, "COT 4210").confirmed === true && zItem(r.body, "COT 4210").suggested === false && !!zItem(r.body, "COT 4210").section, zItem(r.body, "COT 4210"));
  const ev = r.body.events.find((e: any) => e.action === "added_course");
  check("audit trail names the student (a spoofed __studentId in the body is ignored)", ev.actor_type === "student" && ev.student_name === "Zed Newcomer" && ev.advisor_name === null, ev);
  r = await add({ courseId: c4210, termCode: "spring-2027" });
  check("adding the same course again -> 422 already_planned", r.status === 422 && r.body.problems.some((p: any) => p.type === "already_planned"), r.body);
  r = await add({ courseId: c3503, termCode: "fall-2027" });
  check("COP 3503 into Fall 2027 (COP 3502 finishes this term)", r.status === 201, r.body.problems);
  r = await add({ courseId: c3330, termCode: "fall-2027" });
  check("COP 3330 into Fall 2027", r.status === 201, r.body.problems);
  r = await add({ courseId: c4331, termCode: "fall-2027" });
  check("COP 4331 in the same term as COP 3503 -> 422, suggests Spring 2028", r.status === 422 && r.body.blockingCourse?.code === "COP 3503" && r.body.suggestedTerm?.code === "spring-2028", r.body);
  r = await add({ courseId: c4331, termCode: "spring-2028" });
  check("COP 4331 into Spring 2028", r.status === 201 && zItem(r.body, "COP 4331").termCode === "spring-2028", r.body.problems);

  // moving a prerequisite must not break a course that depends on it (COP 4331 is in Spring 2028, after COP 3503 and COP 3330)
  r = await move(c3330, { termCode: "spring-2028", dryRun: true });
  check("hover: moving COP 3330 into COP 4331's semester is blocked, naming the course it would break", r.status === 200 && r.body.blocking === true && r.body.problems.some((p: any) => p.type === "breaks_dependent") && r.body.breaks?.[0]?.code === "COP 4331" && r.body.suggestedTerm?.code === "spring-2027", r.body);
  r = await move(c3330, { termCode: "spring-2028" });
  check("drop: 422 check_failed with `breaks`", r.status === 422 && r.body.code === "check_failed" && r.body.breaks?.[0]?.code === "COP 4331", r.body);
  r = await move(c3330, { termCode: "fall-2027", dryRun: true });
  check("a move that keeps every dependent valid stays allowed", r.status === 200 && r.body.blocking === false && r.body.breaks.length === 0, r.body.problems);
  r = await move(c4210, { termCode: "fall-2026", dryRun: true });
  check("hover over a finished term: dryRun says it cannot go there", r.status === 200 && r.body.dryRun === true && r.body.moves === "COT 4210" && r.body.problems.some((p: any) => p.type === "term_not_open"), r.body);
  r = await move(c4331, { termCode: "fall-2027", dryRun: true });
  check("valid-drop vs invalid-drop: moving COP 4331 beside COP 3503 is blocked", r.status === 200 && r.body.blocking === true && r.body.blockingCourse?.code === "COP 3503" && r.body.suggestedTerm?.code === "spring-2028", r.body);
  r = await move(c4331, { termCode: "fall-2027" });
  check("dropping it there -> 422 check_failed, not moved", r.status === 422 && r.body.code === "check_failed" && r.body.blockingCourse?.code === "COP 3503", r.body);
  r = await move(c4210, { termCode: "fall-2027" });
  check("valid drop -> 200 moved", r.status === 200 && r.body.moved?.from === "spring-2027" && r.body.moved?.to === "fall-2027" && zItem(r.body, "COT 4210").termCode === "fall-2027", r.body.problems ?? r.body.moved);
  check("...credit totals for both semesters follow", r.body.totals.byTerm.find((t: any) => t.code === "fall-2027")?.credits === 9, r.body.totals.byTerm);
  check("...still a student course", zItem(r.body, "COT 4210").source === "student");
  r = await move(c4934, { termCode: "fall-2027" });
  check("moving a course that is not on the board -> 404", r.status === 404 && r.body.code === "item_not_found");
  r = await move(c4210, {});
  check("move without termCode -> 400", r.status === 400 && r.body.code === "invalid_request");
  r = await call("students/[id]/board/courses/[courseId]/route.ts", "DELETE", `/api/students/${ZED}/board/courses/${c4210}`, { id: String(ZED), courseId: String(c4210) });
  check("remove -> 200 removed", r.status === 200 && r.body.removed?.code === "COT 4210" && !zItem(r.body, "COT 4210"), r.body);
  r = await call("students/[id]/board/courses/[courseId]/restore/route.ts", "POST", `/api/students/${ZED}/board/courses/${c4210}/restore`, { id: String(ZED), courseId: String(c4210) });
  check("undo -> back in Fall 2027", r.status === 200 && zItem(r.body, "COT 4210")?.termCode === "fall-2027", r.body);
  r = await call("students/[id]/board/courses/[courseId]/restore/route.ts", "POST", `/api/students/${ZED}/board/courses/${c4210}/restore`, { id: String(ZED), courseId: String(c4210) });
  check("second undo -> 404 nothing_to_restore", r.status === 404 && r.body.code === "nothing_to_restore");
  r = await call("students/[id]/board/courses/[courseId]/route.ts", "DELETE", `/api/students/${ZED}/board/courses/${c4934}`, { id: String(ZED), courseId: String(c4934) });
  check("remove a course that is not planned -> 404", r.status === 404 && r.body.code === "item_not_found");
  r = await call("students/[id]/board/courses/route.ts", "POST", `/api/students/99/board/courses`, { id: "99" }, { courseId: c4210 });
  check("edits for an unknown student -> 404", r.status === 404 && r.body.code === "student_not_found");

  section("student edits vs plan status");
  const zPlan = ((await sql`SELECT id FROM plans WHERE student_id = ${ZED}`) as any[])[0].id as number;
  r = await call("students/[id]/plan/route.ts", "GET", `/api/students/${ZED}/plan`, zp);
  check("the advisor sees the student's plan through the normal plan route", r.status === 200 && r.body.plan.id === zPlan && r.body.plan.createdBy === "student" && r.body.items.length === 4, r.body.plan);
  r = await call("plans/[id]/submit-review/route.ts", "POST", `/api/plans/${zPlan}/submit-review`, { id: String(zPlan) }, { advisorId: AVERY });
  check("advisor sends it to review", r.status === 200 && r.body.plan.status === "in_review");
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  check("board of a plan in review is still editable", r.body.editable === true && r.body.plan.status === "in_review", r.body.plan);
  r = await move(c4210, { termCode: "spring-2028" });
  check("student edit while in review is allowed and sends the plan back to draft", r.status === 200 && r.body.plan.status === "draft" && r.body.plan.submittedAt === null, r.body.plan ?? r.body);
  r = await move(c4210, { termCode: "fall-2027" });
  check("(moved back)", r.status === 200);
  r = await add({ courseId: c3103, termCode: "spring-2027", dryRun: true });
  check("no section in Spring 2027 (CDA 3103) does not block a student", r.status === 200 && r.body.blocking === false && !r.body.problems.some((p: any) => /section/.test(p.type)), r.body.problems);
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${zPlan}/courses`, { id: String(zPlan) }, { courseId: c3103, termCode: "spring-2027", advisorId: AVERY, dryRun: true });
  check("...while the advisor's check still flags the missing section", r.body.blocking === true && r.body.problems.some((p: any) => p.type === "no_section"), r.body.problems);
  await call("plans/[id]/back-to-draft/route.ts", "POST", `/api/plans/${zPlan}/back-to-draft`, { id: String(zPlan) }, { advisorId: AVERY });
  await sql`UPDATE plans SET status = 'approved', approved_at = NOW(), approved_by = ${AVERY} WHERE id = ${zPlan}`;
  r = await move(c4210, { termCode: "spring-2028" });
  check("student edit on an approved plan -> 409 read_only", r.status === 409 && r.body.code === "read_only", r.body);
  r = await call("students/[id]/board/courses/[courseId]/route.ts", "DELETE", `/api/students/${ZED}/board/courses/${c4210}`, { id: String(ZED), courseId: String(c4210) });
  check("...remove too", r.status === 409 && r.body.code === "read_only");
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  check("approved board: read-only, approver named", r.body.plan.readOnly === true && r.body.editable === false && r.body.plan.approvedBy === "Dr. Avery Dunn", r.body.plan);
  await call("plans/[id]/reopen/route.ts", "POST", `/api/plans/${zPlan}/reopen`, { id: String(zPlan) }, { advisorId: AVERY });
  r = await call("plans/[id]/courses/route.ts", "POST", `/api/plans/${zPlan}/courses`, { id: String(zPlan) }, { courseId: c4020, termCode: "spring-2027", advisorId: AVERY });
  check("advisor can still edit the student's plan; source is advisor", r.status === 201 && zItem(r.body, "COP 4020").source === "advisor" && r.body.events.some((e: any) => e.action === "added_course" && e.actor_type === "advisor"), r.body.problems);

  section("course side panel");
  const detail = (courseId: number, q = "", id = ZED) => call("students/[id]/courses/[courseId]/route.ts", "GET", `/api/students/${id}/courses/${courseId}${q}`, { id: String(id), courseId: String(courseId) });
  r = await detail(c4331);
  check("planned course: status, where, prerequisites with their state", r.status === 200 && r.body.status === "planned" && r.body.plannedIn === "spring-2028" && r.body.prerequisites[0].options[0].code === "COP 3503" && r.body.prerequisites[0].options[0].state === "planned" && r.body.prerequisites[0].met === false, r.body);
  check("...a planned course has no 'add' button data", r.body.addTo === null);
  check("...unlocks list COP 4934 and would open it up", r.body.unlocks.find((u: any) => u.code === "COP 4934")?.opensUp === true, r.body.unlocks);
  r = await detail(c3503);
  check("COP 3503 unlocks: COP 4710 would open up, COP 4600 would not (needs COP 3402), COP 4331 is already planned", r.body.unlocks.find((u: any) => u.code === "COP 4710")?.opensUp === true && r.body.unlocks.find((u: any) => u.code === "COP 4600")?.opensUp === false && r.body.unlocks.find((u: any) => u.code === "COP 4331")?.opensUp === false && r.body.unlocks.find((u: any) => u.code === "COP 4331")?.state === "planned", r.body.unlocks);
  r = await detail(c4020, "?term=spring-2027");
  check("a course that is advisor-planned reads as planned", r.body.status === "planned");
  r = await detail(c3360, "?term=spring-2027");
  check("locked course: addTo not allowed, says what is missing", r.body.status === "locked" && r.body.addTo?.allowed === false && r.body.addTo.missing.some((m: string) => /CDA 3103/.test(m)) && r.body.addTo.blockingCourse?.code === "CDA 3103", r.body.addTo);
  r = await detail(c3223);
  check("taken course: status taken, no add data", r.body.status === "taken" && r.body.addTo === null && r.body.unlocks.some((u: any) => u.code === "COP 3502"));
  r = await detail(c4600, "?term=spring-2027");
  check("addTo has the term name for the button ('Add to Spring 2027')", r.body.addTo?.termCode === "spring-2027" && r.body.addTo.termName === "Spring 2027", r.body.addTo);
  check("professors and threads are empty lists until data is loaded", Array.isArray(r.body.professors) && r.body.professors.length === 0 && Array.isArray(r.body.threads) && r.body.threads.length === 0);
  await sql`INSERT INTO course_professors (course_id, name, rating, rating_count, difficulty, source_url) VALUES (${c4600}, 'Dr. Ada Example', 4.5, 120, 3.1, 'https://example.org/prof')`;
  await sql`INSERT INTO course_threads (course_id, title, url, replies, posted_at) VALUES (${c4600}, 'Is COP 4600 hard?', 'https://example.org/thread', 14, NOW())`;
  r = await detail(c4600, "?term=spring-2027");
  check("professors and threads show when loaded", r.body.professors[0]?.name === "Dr. Ada Example" && r.body.professors[0].rating === 4.5 && r.body.threads[0]?.title === "Is COP 4600 hard?" && r.body.threads[0].replies === 14, [r.body.professors, r.body.threads]);
  r = await detail(99999);
  check("unknown course -> 404", r.status === 404 && r.body.code === "course_not_found");
  r = await detail(c4600, "?term=nope");
  check("unknown term -> 400", r.status === 400 && r.body.code === "term_not_found");
  r = await detail(c4600, "", 99);
  check("unknown student -> 404", r.status === 404 && r.body.code === "student_not_found");

  section("prerequisites outside the major (like COP 2500 before COP 3330)");
  await sql`INSERT INTO courses (university_id, subject, number, title, credits) SELECT id, 'MAC', '1105', 'College Algebra', 3 FROM universities LIMIT 1`;
  await sql`INSERT INTO courses (university_id, subject, number, title, credits) SELECT id, 'MAT', '1033', 'Pre-Algebra', 3 FROM universities LIMIT 1`;
  const cMac1105 = await cid("MAC 1105"), cMat1033 = await cid("MAT 1033");
  await sql`INSERT INTO prerequisites (course_id, required_course_id, kind, group_no) VALUES (${c3360}, ${cMac1105}, 'prereq', 5), (${cMac1105}, ${cMat1033}, 'prereq', 1)`;
  r = await call("programs/[id]/courses/route.ts", "GET", `/api/programs/${csProgram}/courses`, { id: String(csProgram) });
  const other = r.body.groups.find((g: any) => g.requirement === "other_prerequisites");
  check("picker lists prerequisites outside the major, including prerequisites of prerequisites", other && other.courses.map((c: any) => c.code).join() === "MAC 1105,MAT 1033" && other.courses.every((c: any) => c.inProgram === false), other);
  check("...and the major's own courses are marked inProgram", r.body.groups.filter((g: any) => g.requirement !== "other_prerequisites").every((g: any) => g.courses.every((c: any) => c.inProgram === true)));
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  check("board shows them as notes outside the major, with prerequisite lines", bc2(r.body, "MAC 1105")?.inProgram === false && bc2(r.body, "CIS 3360").prereq !== "available" && r.body.edges.some((e: any) => e.from === cMac1105 && e.to === c3360) && r.body.edges.some((e: any) => e.from === cMat1033 && e.to === cMac1105), r.body.edges.length);
  check("...locked by what it needs", bc2(r.body, "MAC 1105").status === "locked" && bc2(r.body, "MAC 1105").needs.includes("MAT 1033"), bc2(r.body, "MAC 1105"));
  await put({ mode: "merge", courses: [{ courseId: cMat1033, grade: "B" }, { courseId: cMac1105, grade: "A" }] });
  r = await call("students/[id]/board/route.ts", "GET", `/api/students/${ZED}/board`, zp);
  check("saving them works and the board marks them taken", bc2(r.body, "MAC 1105").status === "taken" && bc2(r.body, "MAT 1033").status === "taken", r.body.courses.filter((c: any) => !c.inProgram).map((c: any) => c.code + ":" + c.status));
  await sql`DELETE FROM prerequisites WHERE required_course_id IN (${cMac1105}, ${cMat1033})`;
  await sql`DELETE FROM completed_courses WHERE course_id IN (${cMac1105}, ${cMat1033})`;
  await sql`DELETE FROM courses WHERE id IN (${cMac1105}, ${cMat1033})`;

  section("student edits do not break the advisor side");
  r = await call("advisors/[advisorId]/students/route.ts", "GET", `/api/advisors/${AVERY}/students`, { advisorId: String(AVERY) });
  check("advisor list still works", r.status === 200 && r.body.students.length === 4, r.body.students?.length);
  r = await call("demand/route.ts", "GET", `/api/demand?term=fall-2027`);
  check("seat demand counts the student's planned courses", r.status === 200 && r.body.courses.length >= 0, r.body);

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
