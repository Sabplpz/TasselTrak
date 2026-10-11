import { sql } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { Term, allTerms, byCode, byId, currentTermOf, fmtGroup, termsAfter } from "@/lib/terms";
import {
  Course, Graph, History, Planned, loadCatalog, loadGraph, loadHistory, prereqStatus, unmetGroups,
} from "@/lib/prereq";

export const PLAN_TERM = process.env.PLAN_TERM || "spring-2027";
export const SEAT_RISK_AT = 6; // same threshold the seeded seat_risk flags use
export const MAX_OVER_TARGET = 3;

// "GEP HUM1", "ELEC TECH3"... are requirement slots, not real classes: they have no sections.
export const isSlot = (code: string) => /^(GEP|ELEC) /.test(code);

export type Issue = {
  type:
    | "not_eligible"
    | "already_completed"
    | "already_planned"
    | "no_section"
    | "seat_full"
    | "seat_risk"
    | "time_conflict"
    | "credits_over"
    | "credits_under"
    | "not_in_program"
    | "term_not_open";
  severity: "high" | "medium" | "low";
  message: string;
  courseId?: number;
  code?: string;
  termCode?: string;
  overridden?: boolean;
};

export type Section = {
  id: number;
  crn: string | null;
  section_code: string | null;
  modality: string | null;
  days: string[];
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  enrolled: number | null;
  seats_open: number | null;
  instructor: string | null;
};

// ---------------------------------------------------------------- context

export type Ctx = {
  terms: Term[];
  planTerm: Term;
  current: Term | null;
  currentKey: number; // key of the term students are in now (0 if none)
  student: any;
  graph: Graph;
  catalog: Map<number, Course>;
  history: History;
};

export async function getStudent(studentId: number) {
  const [s] = await sql`
    SELECT s.id, s.display_name, s.advisor_id, s.program_id, s.target_credits,
           s.work_hours_per_week, s.preferences, p.name AS program_name
    FROM students s LEFT JOIN programs p ON p.id = s.program_id
    WHERE s.id = ${studentId}`;
  return s as any | undefined;
}

export async function getTerm(code = PLAN_TERM) {
  const [t] = await sql`SELECT id, code, name FROM terms WHERE code = ${code} LIMIT 1`;
  if (!t) throw new Error(`Term '${code}' not found`);
  return t as { id: number; code: string; name: string };
}

export async function loadCtx(studentId: number): Promise<Ctx> {
  const student = await getStudent(studentId);
  if (!student) throw new ApiError("student_not_found", "Student not found", 404);
  const terms = await allTerms();
  const planTerm = byCode(terms, PLAN_TERM);
  if (!planTerm) throw new Error(`Term '${PLAN_TERM}' not found`);
  const current = currentTermOf(terms, planTerm);
  const currentKey = current?.key ?? 0;
  const [graph, catalog, history] = await Promise.all([
    loadGraph(student.program_id),
    loadCatalog(),
    loadHistory(studentId, terms, currentKey),
  ]);
  return { terms, planTerm, current, currentKey, student, graph, catalog, history };
}

// ---------------------------------------------------------------- sections

export async function sectionsFor(courseIds: number[], termId: number): Promise<Record<number, Section[]>> {
  if (!courseIds.length) return {};
  const rows = await sql`
    SELECT s.id, s.course_id, s.crn, s.section_code, s.modality, s.days,
           s.start_time::text AS start_time, s.end_time::text AS end_time,
           s.capacity, s.enrolled, s.seats_open, i.name AS instructor
    FROM sections s LEFT JOIN instructors i ON i.id = s.instructor_id
    WHERE s.term_id = ${termId} AND s.course_id = ANY(${courseIds}::int[])
    ORDER BY s.course_id, s.section_code`;
  const out: Record<number, Section[]> = {};
  for (const r of rows as any[]) (out[r.course_id] ||= []).push(r as Section);
  return out;
}

// Terms that have a published schedule. Future terms usually do not, and a course planned
// there must not be flagged "no section".
export async function termIdsWithSections(termIds: number[]): Promise<Set<number>> {
  if (!termIds.length) return new Set();
  const rows = (await sql`SELECT DISTINCT term_id FROM sections WHERE term_id = ANY(${termIds}::int[])`) as any[];
  return new Set(rows.map((r) => r.term_id));
}

export function overlaps(a: Section, b: Section): boolean {
  if (!a.days?.length || !b.days?.length) return false; // online / async
  if (!a.start_time || !b.start_time || !a.end_time || !b.end_time) return false;
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

export const conflicts = (sec: Section, chosen: Section[]) => chosen.some((c) => overlaps(sec, c));

// Best section for a course given what is already chosen: no conflicts, seats open,
// respects "avoid_mornings", most open seats first.
export function pickSection(secs: Section[] = [], chosen: Section[], prefs: any): Section | null {
  const avoidMornings = !!prefs?.avoid_mornings;
  const usable = secs.filter((s) => (s.seats_open ?? 0) > 0 && !conflicts(s, chosen));
  const score = (s: Section) =>
    (avoidMornings && s.start_time && s.start_time < "10:00:00" ? 1000 : 0) - (s.seats_open ?? 0);
  return usable.sort((a, b) => score(a) - score(b))[0] ?? null;
}

// ---------------------------------------------------------------- prerequisites (legacy helper)

// Which prerequisite groups does this student still miss for the NEXT term? (kept for callers)
export async function missingPrereqs(studentId: number, courseId: number): Promise<string[][]> {
  const ctx = await loadCtx(studentId);
  return unmetGroups(ctx.graph, courseId, ctx.planTerm.key, ctx.history, []).map((g) =>
    g.map((id) => ctx.catalog.get(id)?.code ?? String(id))
  );
}

const codesOf = (ctx: Ctx, group: number[]) => group.map((id) => ctx.catalog.get(id)?.code ?? String(id)).sort();

// ---------------------------------------------------------------- candidates

export type Cand = Course & {
  course_id: number;
  category: string;
  group_label: string | null;
  pick_count: number | null;
  critical_path: boolean;
  depth: number;
  unmet: number[][];
  slotsLeft: number;
  sections: Section[];
};

// Remaining requirements for the student's program, with prerequisite state for `term`.
// `planned` is what else is on the board (so a course is not offered twice and pick-N groups
// count what is already planned).
export async function candidatesFor(ctx: Ctx, term: Term, planned: Planned[], withSections = true): Promise<Cand[]> {
  const reqs = (await sql`
    SELECT pr.course_id, pr.category, pr.group_label, pr.pick_count, pr.critical_path, COALESCE(d.depth, 1)::int AS depth
    FROM program_requirements pr
    LEFT JOIN program_course_depth d ON d.program_id = pr.program_id AND d.course_id = pr.course_id
    WHERE pr.program_id = ${ctx.student.program_id}`) as any[];

  const taken = new Set<number>([...ctx.history.passed, ...ctx.history.inProgress.keys()]);
  const plannedIds = new Set(planned.map((p) => p.courseId));
  const doneBy: Record<string, number> = {};
  for (const r of reqs)
    if (r.group_label && r.pick_count != null && (taken.has(r.course_id) || plannedIds.has(r.course_id)))
      doneBy[r.group_label] = (doneBy[r.group_label] ?? 0) + 1;

  const open = reqs.filter((r) => !taken.has(r.course_id) && !plannedIds.has(r.course_id) && ctx.catalog.has(r.course_id));
  const secs = withSections ? await sectionsFor(open.map((r) => r.course_id), term.id) : {};
  return open.map((r) => ({
    ...(ctx.catalog.get(r.course_id) as Course),
    course_id: r.course_id,
    category: r.category,
    group_label: r.group_label,
    pick_count: r.pick_count,
    critical_path: !!r.critical_path,
    depth: Number(r.depth),
    unmet: unmetGroups(ctx.graph, r.course_id, term.key, ctx.history, planned),
    slotsLeft: r.pick_count == null ? Infinity : Math.max(0, r.pick_count - (doneBy[r.group_label ?? ""] ?? 0)),
    sections: secs[r.course_id] ?? [],
  }));
}

export const byPriority = (a: Cand, b: Cand) =>
  Number(b.critical_path) - Number(a.critical_path) || a.depth - b.depth || a.code.localeCompare(b.code);

// ---------------------------------------------------------------- reading a plan

type ItemRow = {
  id: number; term_id: number; course_id: number; section_id: number | null; reason: string | null;
  source: "ai" | "advisor"; confirmed: boolean; override_by: number | null; override_note: string | null;
  override_at: string | null; override_name: string | null; code: string; title: string; credits: number;
};

export async function loadItems(planId: number): Promise<ItemRow[]> {
  return (await sql`
    SELECT pi.id, pi.term_id, pi.course_id, pi.section_id, pi.reason, pi.source, pi.confirmed,
           pi.override_by, pi.override_note, pi.override_at, oa.name AS override_name,
           c.code, c.title, c.credits::float8 AS credits
    FROM plan_items pi
    JOIN courses c ON c.id = pi.course_id
    JOIN terms t ON t.id = pi.term_id
    LEFT JOIN advisors oa ON oa.id = pi.override_by
    WHERE pi.plan_id = ${planId}
    ORDER BY t.year, CASE t.season WHEN 'spring' THEN 1 WHEN 'summer' THEN 2 ELSE 3 END, c.code`) as any[];
}

export const rationalePoints = (r: string | null | undefined): string[] =>
  String(r ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export async function getPlan(planId: number) {
  const [plan] = (await sql`
    SELECT p.*, a.name AS approved_by_name
    FROM plans p LEFT JOIN advisors a ON a.id = p.approved_by
    WHERE p.id = ${planId}`) as any[];
  if (!plan) return null;
  const ctx = await loadCtx(plan.student_id);
  const { student, terms } = ctx;

  const items = await loadItems(planId);
  const termOf = (id: number) => byId(terms, id) as Term;

  const sectionIds = items.map((i) => i.section_id).filter(Boolean);
  const secRows = sectionIds.length
    ? ((await sql`
        SELECT s.id, s.crn, s.section_code, s.modality, s.days,
               s.start_time::text AS start_time, s.end_time::text AS end_time,
               s.capacity, s.enrolled, s.seats_open, i.name AS instructor
        FROM sections s LEFT JOIN instructors i ON i.id = s.instructor_id
        WHERE s.id = ANY(${sectionIds}::int[])`) as any[])
    : [];
  const secById = new Map<number, Section>(secRows.map((s) => [s.id, s as Section]));

  const itemTermIds = [...new Set(items.map((i) => i.term_id))];
  const scheduled = await termIdsWithSections(itemTermIds);

  const reqRows = (await sql`
    SELECT course_id, category, group_label FROM program_requirements WHERE program_id = ${student.program_id}`) as any[];
  const reqBy = new Map<number, { category: string; group_label: string | null }>(reqRows.map((r) => [r.course_id, r]));

  const planned: Planned[] = items.map((i) => ({ courseId: i.course_id, termKey: termOf(i.term_id).key }));

  const outItems = items.map((it) => {
    const term = termOf(it.term_id);
    const sec = it.section_id ? secById.get(it.section_id) ?? null : null;
    const overridden = it.override_by != null;
    const issues: Issue[] = [];
    const base = { courseId: it.course_id, code: it.code, termCode: term.code };
    const others = planned.filter((p) => p.courseId !== it.course_id);

    if (ctx.history.passed.has(it.course_id))
      issues.push({ ...base, type: "already_completed", severity: "high", message: `${it.code} is already completed.` });

    const unmet = unmetGroups(ctx.graph, it.course_id, term.key, ctx.history, others);
    if (unmet.length)
      issues.push({ ...base, type: "not_eligible", severity: "high", message: `${it.code} needs ${unmet.map((g) => fmtGroup(codesOf(ctx, g))).join(" and ")} first.` });

    if (!reqBy.has(it.course_id))
      issues.push({ ...base, type: "not_in_program", severity: "low", message: `${it.code} is not a listed requirement for this program.` });

    // Seats and sections only matter for terms that have a published schedule.
    if (scheduled.has(it.term_id) && !isSlot(it.code)) {
      if (!sec) issues.push({ ...base, type: "no_section", severity: "high", message: `No open section chosen for ${it.code}.` });
      else if ((sec.seats_open ?? 0) <= 0) issues.push({ ...base, type: "seat_full", severity: "high", message: `${it.code} section ${sec.section_code} is full.` });
      else if ((sec.seats_open ?? 0) <= SEAT_RISK_AT)
        issues.push({ ...base, type: "seat_risk", severity: "medium", message: `${it.code} has only ${sec.seats_open} seats left.` });
    }

    const ps = prereqStatus(ctx.graph, it.course_id, ctx.history);
    const req = reqBy.get(it.course_id);
    return {
      id: it.id,
      courseId: it.course_id,
      code: it.code,
      title: it.title,
      credits: it.credits,
      termCode: term.code,
      termName: term.name,
      reason: it.reason,
      source: it.source,
      confirmed: it.confirmed,
      suggested: it.source === "ai" && !it.confirmed,
      fills: req?.group_label ?? null,
      status: ps.status,
      needs: ps.waiting.map((w) => fmtGroup(codesOf(ctx, w.ids))),
      section: sec,
      issues,
      override: overridden
        ? { advisorId: it.override_by, advisorName: it.override_name, at: it.override_at, note: it.override_note }
        : null,
      _termId: it.term_id,
    };
  });

  // time clashes: same term only
  const planIssues: (Issue & { codes?: string[] })[] = [];
  for (let i = 0; i < outItems.length; i++)
    for (let j = i + 1; j < outItems.length; j++) {
      const a = outItems[i], b = outItems[j];
      if (a._termId !== b._termId || !a.section || !b.section || !overlaps(a.section, b.section)) continue;
      const msg = `${a.code} and ${b.code} meet at overlapping times.`;
      planIssues.push({ type: "time_conflict", severity: "high", message: msg, termCode: a.termCode, codes: [a.code, b.code] });
      a.issues.push({ type: "time_conflict", severity: "high", message: msg, code: a.code, courseId: a.courseId, termCode: a.termCode });
      b.issues.push({ type: "time_conflict", severity: "high", message: msg, code: b.code, courseId: b.courseId, termCode: b.termCode });
    }

  // credits per term
  const target: number = student.target_credits;
  const creditsByTerm = new Map<number, number>();
  for (const it of outItems) creditsByTerm.set(it._termId, (creditsByTerm.get(it._termId) ?? 0) + it.credits);
  for (const [termId, credits] of creditsByTerm) {
    const t = termOf(termId);
    if (credits > target + MAX_OVER_TARGET)
      planIssues.push({ type: "credits_over", severity: "medium", termCode: t.code, message: `${credits} credits in ${t.name} is above the ${target}-credit target.` });
    if (t.id === ctx.planTerm.id && credits < Math.min(9, target))
      planIssues.push({ type: "credits_under", severity: "medium", termCode: t.code, message: `${credits} credits in ${t.name} is light for a ${target}-credit target.` });
  }

  // An override tag only shows while it still covers a problem (a stale tag would mislead the hover text).
  for (const it of outItems) {
    if (it.override && !it.issues.length && !planIssues.some((x) => x.codes?.includes(it.code))) it.override = null;
  }

  // mark overrides, then count each problem once
  const overriddenCodes = new Set(outItems.filter((i) => i.override).map((i) => i.code));
  for (const it of outItems) for (const x of it.issues) if (it.override) x.overridden = true;
  for (const x of planIssues) if (x.codes?.some((c) => overriddenCodes.has(c))) x.overridden = true;

  const blockingIssues: Issue[] = [
    ...outItems.flatMap((i) => i.issues.filter((x) => x.severity === "high" && x.type !== "time_conflict" && !x.overridden)),
    ...planIssues.filter((x) => x.severity === "high" && !x.overridden),
  ];

  // ---- terms (history + planned) and the credit line under each header
  const termRows = new Map<number, { term: Term; credits: number; courses: number }>();
  const touch = (t: Term, credits: number) => {
    const r = termRows.get(t.id) ?? { term: t, credits: 0, courses: 0 };
    r.credits += credits;
    r.courses += 1;
    termRows.set(t.id, r);
  };
  const history = ctx.history.rows
    .map((h) => {
      const t = (h.termId ? byId(terms, h.termId) : null) ?? ctx.current;
      if (t) touch(t, h.credits);
      return {
        courseId: h.courseId, code: h.code, title: h.title, credits: h.credits, grade: h.grade,
        status: h.inProgress ? "in_progress" : h.passed ? "taken" : "not_passed",
        termCode: t?.code ?? null,
        _key: t?.key ?? 0,
      };
    })
    .sort((a, b) => a._key - b._key || a.code.localeCompare(b.code))
    .map(({ _key, ...h }) => h);
  for (const it of outItems) touch(termOf(it._termId), it.credits);

  const termList = [...termRows.values()]
    .sort((a, b) => a.term.key - b.term.key)
    .map(({ term, credits, courses }) => {
      const state = term.key < ctx.currentKey ? "completed" : term.key === ctx.currentKey ? "current" : "planned";
      return {
        code: term.code,
        name: term.name,
        state,
        now: state === "current",
        label: state === "completed" ? "Completed" : state === "current" ? "In progress" : term.id === ctx.planTerm.id ? "Up next" : "Later",
        credits,
        courses,
        scheduleAvailable: state === "planned" ? scheduled.has(term.id) : null,
      };
    });

  const events = (await sql`
    SELECT e.id, e.actor_type, e.action, e.detail, e.created_at, a.name AS advisor_name
    FROM plan_events e LEFT JOIN advisors a ON a.id = e.advisor_id
    WHERE e.plan_id = ${planId} ORDER BY e.created_at, e.id`) as any[];

  const planCredits = outItems.reduce((s, i) => s + i.credits, 0);
  const firstTerm = termList.find((t) => t.state === "planned");
  const publicItems = outItems.map(({ _termId, ...rest }) => rest);

  return {
    plan: {
      id: plan.id,
      studentId: plan.student_id,
      studentName: student.display_name,
      programName: student.program_name,
      name: plan.name,
      status: plan.status,
      createdBy: plan.created_by,
      modelName: plan.model_name,
      rationale: plan.rationale,
      rationalePoints: rationalePoints(plan.rationale),
      submittedAt: plan.submitted_at ?? null,
      approvedAt: plan.approved_at,
      approvedBy: plan.approved_by_name ?? null,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
    },
    // `term` is the first planned term (kept for older clients); `terms` is the whole board.
    term: firstTerm ? { code: firstTerm.code, name: firstTerm.name } : { code: ctx.planTerm.code, name: ctx.planTerm.name },
    terms: termList,
    history,
    items: publicItems,
    totals: {
      credits: planCredits,
      target,
      courses: outItems.length,
      terms: new Set(outItems.map((i) => i._termId)).size,
      overrides: outItems.filter((i) => i.override).length,
      byTerm: termList.filter((t) => t.state === "planned").map((t) => ({ code: t.code, credits: t.credits })),
    },
    issues: planIssues.map(({ codes, ...x }) => x),
    blockingIssues,
    blocking: blockingIssues.length,
    canApprove: outItems.length > 0 && blockingIssues.length === 0,
    readOnly: plan.status === "approved",
    events,
  };
}

// ---------------------------------------------------------------- checking an edit

// Can this course go into `termCode` (default: the next term), optionally replacing one item?
export async function checkAddition(planId: number, courseId: number, opts: { replaceItemId?: number; termCode?: string } = {}) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) throw new ApiError("plan_not_found", "Plan not found", 404);
  const ctx = await loadCtx(plan.student_id);
  const term = opts.termCode ? byCode(ctx.terms, opts.termCode) : ctx.planTerm;
  if (!term) throw new ApiError("term_not_found", `Unknown term '${opts.termCode}'`, 400);

  const course = ctx.catalog.get(courseId);
  if (!course) return { found: false as const };

  const others = (await sql`
    SELECT pi.id, pi.course_id, pi.section_id, pi.term_id FROM plan_items pi
    WHERE pi.plan_id = ${planId} AND pi.id <> ${opts.replaceItemId ?? 0}`) as any[];
  const plannedOthers: Planned[] = others.map((o) => ({ courseId: o.course_id, termKey: (byId(ctx.terms, o.term_id) as Term).key }));

  const duplicate = others.some((o) => o.course_id === courseId);
  const passed = ctx.history.passed.has(courseId);
  const unmet = unmetGroups(ctx.graph, courseId, term.key, ctx.history, plannedOthers);
  const [inProgram] = (await sql`
    SELECT 1 FROM program_requirements WHERE program_id = ${ctx.student.program_id} AND course_id = ${courseId} LIMIT 1`) as any[];

  const scheduled = (await termIdsWithSections([term.id])).has(term.id);
  const keptSecIds = others.filter((o) => o.term_id === term.id).map((o) => o.section_id).filter(Boolean);
  const kept = keptSecIds.length
    ? ((await sql`SELECT id, days, start_time::text AS start_time, end_time::text AS end_time, seats_open FROM sections WHERE id = ANY(${keptSecIds}::int[])`) as any[])
    : [];
  const secs = scheduled ? (await sectionsFor([courseId], term.id))[courseId] ?? [] : [];
  const section = scheduled ? pickSection(secs, kept as Section[], ctx.student.preferences) : null;

  const problems: Issue[] = [];
  const base = { courseId, code: course.code, termCode: term.code };
  if (duplicate) problems.push({ ...base, type: "already_planned", severity: "high", message: `${course.code} is already in this plan.` });
  if (passed) problems.push({ ...base, type: "already_completed", severity: "high", message: `${course.code} is already completed.` });
  if (unmet.length)
    problems.push({ ...base, type: "not_eligible", severity: "high", message: `${course.code} needs ${unmet.map((g) => fmtGroup(codesOf(ctx, g))).join(" and ")} first.` });
  if (ctx.current && term.key <= ctx.currentKey)
    problems.push({ ...base, type: "term_not_open", severity: "high", message: `${term.name} has already started or finished, so courses can only be planned for later terms.` });
  if (!inProgram) problems.push({ ...base, type: "not_in_program", severity: "low", message: `${course.code} is not a listed requirement for this program.` });
  if (scheduled && !isSlot(course.code)) {
    if (!secs.length) problems.push({ ...base, type: "no_section", severity: "high", message: `${course.code} has no section in ${term.name}.` });
    else if (!section) problems.push({ ...base, type: "time_conflict", severity: "high", message: `Every open section of ${course.code} conflicts with the plan or is full.` });
  }

  // The first prerequisite group with a single course is "the blocking course" in the Figma.
  const firstSingle = unmet.find((g) => g.length === 1) ?? unmet[0];
  const blockingCourse = firstSingle
    ? (() => {
        const id = firstSingle[0];
        const c = ctx.catalog.get(id);
        return { courseId: id, code: c?.code ?? String(id), title: c?.title ?? "", inProgress: ctx.history.inProgress.has(id) };
      })()
    : null;

  // Earliest later term where the course would be allowed ("Move to Spring 2027").
  let suggestedTerm: { code: string; name: string } | null = null;
  if (unmet.length || (ctx.current && term.key <= ctx.currentKey)) {
    for (const t of termsAfter(ctx.terms, ctx.currentKey, 8)) {
      if (!unmetGroups(ctx.graph, courseId, t.key, ctx.history, plannedOthers).length) {
        suggestedTerm = { code: t.code, name: t.name };
        break;
      }
    }
  }

  return {
    found: true as const,
    course,
    eligible: !unmet.length && !passed,
    missing: unmet.map((g) => fmtGroup(codesOf(ctx, g))),
    section,
    problems,
    blocking: problems.some((p) => p.severity === "high"),
    termId: term.id,
    term: { code: term.code, name: term.name },
    blockingCourse,
    suggestedTerm,
  };
}

// ---------------------------------------------------------------- picker + alternatives

// Everything the "Add course" picker needs: remaining requirements grouped by what they fill.
export async function courseOptions(planId: number, termCode?: string, search?: string) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) return null;
  const ctx = await loadCtx(plan.student_id);
  const term = termCode ? byCode(ctx.terms, termCode) : ctx.planTerm;
  if (!term) throw new ApiError("term_not_found", `Unknown term '${termCode}'`, 400);

  const items = await loadItems(planId);
  const planned: Planned[] = items.map((i) => ({ courseId: i.course_id, termKey: (byId(ctx.terms, i.term_id) as Term).key }));
  const scheduled = (await termIdsWithSections([term.id])).has(term.id);
  const q = (search ?? "").trim().toLowerCase();
  const cands = (await candidatesFor(ctx, term, planned, scheduled))
    .filter((c) => c.slotsLeft > 0)
    .filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
    .sort(byPriority);

  const groups = new Map<string, any>();
  for (const c of cands) {
    const key = c.group_label ?? c.category;
    const g = groups.get(key) ?? { requirement: key, fills: c.group_label, courses: [] as any[] };
    g.courses.push({
      courseId: c.course_id, code: c.code, title: c.title, credits: c.credits, category: c.category,
      criticalPath: c.critical_path, isSlot: isSlot(c.code),
      prerequisitesMet: !c.unmet.length,
      missing: c.unmet.map((u) => fmtGroup(codesOf(ctx, u))),
      seatsOpen: scheduled && c.sections.length ? Math.max(...c.sections.map((s) => s.seats_open ?? 0)) : null,
    });
    groups.set(key, g);
  }
  return {
    term: { code: term.code, name: term.name, open: !ctx.current || term.key > ctx.currentKey, scheduleAvailable: scheduled },
    groups: [...groups.values()],
  };
}

// Alternatives for the swap dialog: courses that could take this item's place.
export async function alternatives(planId: number, itemId?: number, termCode?: string) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) return null;
  const ctx = await loadCtx(plan.student_id);
  const items = await loadItems(planId);
  const item = itemId ? items.find((i) => i.id === itemId) : undefined;
  const term = item ? (byId(ctx.terms, item.term_id) as Term) : termCode ? byCode(ctx.terms, termCode) ?? ctx.planTerm : ctx.planTerm;
  const others = items.filter((i) => i.id !== item?.id);
  const planned: Planned[] = others.map((i) => ({ courseId: i.course_id, termKey: (byId(ctx.terms, i.term_id) as Term).key }));
  const scheduled = (await termIdsWithSections([term.id])).has(term.id);
  return (await candidatesFor(ctx, term, planned, scheduled))
    .filter((c) => !c.unmet.length && c.slotsLeft > 0 && c.course_id !== item?.course_id)
    .filter((c) => !scheduled || isSlot(c.code) || c.sections.length > 0)
    .sort(byPriority)
    .map((c) => ({
      courseId: c.course_id,
      code: c.code,
      title: c.title,
      credits: c.credits,
      category: c.category,
      groupLabel: c.group_label,
      fills: c.group_label,
      criticalPath: c.critical_path,
      depth: c.depth,
      isSlot: isSlot(c.code),
      seatsOpen: scheduled && c.sections.length ? Math.max(...c.sections.map((s) => s.seats_open ?? 0)) : null,
    }));
}

// ---------------------------------------------------------------- removing a course

// Courses that stop being valid if `courseId` leaves the plan. `direct` ones depended on it
// themselves; the rest only break because a direct one broke.
export async function dependents(planId: number, courseId: number) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) return null;
  const ctx = await loadCtx(plan.student_id);
  const items = await loadItems(planId);
  const target = items.find((i) => i.course_id === courseId);
  if (!target) return { course: null, dependents: [] as any[] };

  const keyOf = (i: ItemRow) => (byId(ctx.terms, i.term_id) as Term).key;
  const ok = (i: ItemRow, set: ItemRow[]) =>
    !unmetGroups(ctx.graph, i.course_id, keyOf(i), ctx.history, set.filter((x) => x.id !== i.id).map((x) => ({ courseId: x.course_id, termKey: keyOf(x) }))).length;

  const wasOk = new Set(items.filter((i) => ok(i, items)).map((i) => i.id));
  let remaining = items.filter((i) => i.id !== target.id);
  const out: any[] = [];
  let wave = 0;
  for (;;) {
    const broke = remaining.filter((i) => wasOk.has(i.id) && !ok(i, remaining));
    if (!broke.length) break;
    wave += 1;
    for (const b of broke) {
      const t = byId(ctx.terms, b.term_id) as Term;
      out.push({ courseId: b.course_id, code: b.code, title: b.title, termCode: t.code, termName: t.name, direct: wave === 1, becomes: "blocked" });
    }
    const gone = new Set(broke.map((b) => b.id));
    remaining = remaining.filter((i) => !gone.has(i.id));
  }
  return { course: { courseId: target.course_id, code: target.code, title: target.title }, dependents: out };
}

// ---------------------------------------------------------------- status + audit

export async function logEvent(planId: number, advisorId: number | null, action: string, detail: object) {
  await sql`INSERT INTO plan_events (plan_id, actor_type, advisor_id, action, detail)
            VALUES (${planId}, 'advisor', ${advisorId}, ${action}, ${JSON.stringify(detail)}::jsonb)`;
}

// Any advisor edit puts the plan back to Draft and clears an earlier review or approval.
export async function touchPlan(planId: number) {
  await sql`UPDATE plans SET status = 'draft', approved_at = NULL, approved_by = NULL, submitted_at = NULL,
            updated_at = NOW() WHERE id = ${planId}`;
}

// Edits are refused on an approved (read-only) or archived plan.
export async function assertEditable(planId: number) {
  const [p] = (await sql`SELECT id, status FROM plans WHERE id = ${planId}`) as any[];
  if (!p) throw new ApiError("plan_not_found", "Plan not found", 404);
  if (p.status === "approved")
    throw new ApiError("read_only", "This plan is approved and read-only. Reopen it to make changes.", 409);
  if (p.status === "archived")
    throw new ApiError("archived", "This plan was replaced by a newer draft.", 409);
  return p as { id: number; status: string };
}

export async function getAdvisor(advisorId: number | null) {
  if (!advisorId) return null;
  const [a] = (await sql`SELECT id, name, can_override FROM advisors WHERE id = ${advisorId}`) as any[];
  return (a as { id: number; name: string; can_override: boolean } | undefined) ?? null;
}
