import { sql } from "@/lib/db";
import { ApiError, failCode, ok } from "@/lib/api";
import { PLAN_TERM, checkAdditionFor, getPlan, isSlot, loadCtx } from "@/lib/plan";
import { allTerms, byCode, byId, currentTermOf, fmtGroup, termsAfter } from "@/lib/terms";
import { Graph, HistoryRow, loadGraph, prereqStatus } from "@/lib/prereq";
import { addCourse, moveItem, removeItem, restoreCourse, findItem, itemNotFound } from "@/lib/plan-actions";

export const degreeCredits = (programTotal: number | null | undefined) =>
  programTotal ?? Number(process.env.DEGREE_CREDITS ?? 120);

// Seat and section tracking is not part of the student side.
const SEAT_ISSUES = new Set(["no_section", "seat_full", "seat_risk", "time_conflict"]);
const VALID_GRADE = /^((A|B|C|D)[+-]?|F|W|P|S|TC)$/;

// ---------------------------------------------------------------- the student's plan

// The student's current plan row (draft, in review or approved), or null.
export async function currentPlanId(studentId: number): Promise<number | null> {
  const [p] = (await sql`
    SELECT id FROM plans WHERE student_id = ${studentId} AND status <> 'archived'
    ORDER BY created_at DESC, id DESC LIMIT 1`) as any[];
  return p?.id ?? null;
}

async function ensurePlan(studentId: number): Promise<number> {
  const existing = await currentPlanId(studentId);
  if (existing) return existing;
  const [p] = (await sql`
    INSERT INTO plans (student_id, name, status, created_by) VALUES (${studentId}, 'My plan', 'draft', 'student')
    RETURNING id`) as any[];
  await sql`INSERT INTO plan_events (plan_id, actor_type, student_id, action, detail)
            VALUES (${p.id}, 'student', ${studentId}, 'created', '{}'::jsonb)`;
  return p.id;
}

// ---------------------------------------------------------------- login list (demo, no real auth)

export async function listStudents(search: string | null, limit: number, offset: number) {
  const rows = (await sql`
    SELECT s.id AS student_id, s.display_name, s.is_synthetic, p.name AS program_name, a.name AS advisor_name,
           (SELECT COUNT(*)::int FROM completed_courses cc WHERE cc.student_id = s.id) AS courses_on_file,
           (SELECT pl.status FROM plans pl WHERE pl.student_id = s.id AND pl.status <> 'archived'
            ORDER BY pl.created_at DESC, pl.id DESC LIMIT 1) AS plan_status
    FROM students s
    LEFT JOIN programs p ON p.id = s.program_id
    LEFT JOIN advisors a ON a.id = s.advisor_id
    WHERE (${search}::text IS NULL OR s.display_name ILIKE '%' || ${search}::text || '%')
    ORDER BY s.display_name
    LIMIT ${limit} OFFSET ${offset}`) as any[];
  const [{ n }] = (await sql`
    SELECT COUNT(*)::int AS n FROM students s
    WHERE (${search}::text IS NULL OR s.display_name ILIKE '%' || ${search}::text || '%')`) as any[];
  return {
    page: { limit, offset, total: n as number },
    students: rows.map((r) => ({
      student_id: r.student_id,
      display_name: r.display_name,
      program_name: r.program_name,
      advisor_name: r.advisor_name,
      courses_on_file: r.courses_on_file,
      plan_status: r.plan_status,
      sample: !!r.is_synthetic,
    })),
  };
}

// The student is found by id, or by the email of the signed-in account (students.email, any case).
export async function loginStudent(by: { studentId: number } | { email: string }) {
  const studentId = "studentId" in by ? by.studentId : null;
  const email = "email" in by ? by.email : null;
  const [s] = (await sql`
    SELECT s.id, s.display_name, s.program_id, p.name AS program_name,
           (SELECT COUNT(*)::int FROM completed_courses cc WHERE cc.student_id = s.id) AS n
    FROM students s LEFT JOIN programs p ON p.id = s.program_id
    WHERE s.id = ${studentId}::int OR lower(s.email) = lower(${email}::text)
    ORDER BY s.id LIMIT 1`) as any[];
  if (!s) throw new ApiError("student_not_found", "Student not found", 404);
  return {
    studentId: s.id as number,
    student: { id: s.id, name: s.display_name, programId: s.program_id, programName: s.program_name },
    // Screen 1 (upload / manual picker) when nothing is on file, otherwise straight to the canvas.
    next: s.n > 0 && s.program_id ? "board" : "upload",
  };
}

// Courses that are prerequisites of the major\'s courses (any depth) but are not themselves listed requirements,
// for example COP 2500 before COP 3330. Students can have taken them and the board must be able to show them.
export function outsidePrereqIds(graph: Graph, programCourseIds: Set<number>): number[] {
  const seen = new Set<number>();
  const queue = [...programCourseIds];
  while (queue.length) {
    const c = queue.pop() as number;
    for (const group of graph.get(c) ?? [])
      for (const r of group)
        if (!programCourseIds.has(r) && !seen.has(r)) { seen.add(r); queue.push(r); }
  }
  return [...seen];
}

// ---------------------------------------------------------------- programs (screen 5)

export async function listPrograms() {
  const rows = (await sql`
    SELECT p.id, p.name, p.degree_type, p.catalog_year, p.total_credits,
           (SELECT COUNT(*)::int FROM program_requirements pr WHERE pr.program_id = p.id) AS courses
    FROM programs p ORDER BY p.name`) as any[];
  return rows.map((p) => ({
    id: p.id, name: p.name, degreeType: p.degree_type, catalogYear: p.catalog_year,
    totalCredits: degreeCredits(p.total_credits), courses: p.courses,
  }));
}

export async function programCourses(programId: number) {
  const [program] = (await sql`SELECT id, name, degree_type, catalog_year, total_credits FROM programs WHERE id = ${programId}`) as any[];
  if (!program) throw new ApiError("program_not_found", "Program not found", 404);
  const rows = (await sql`
    SELECT c.id, c.code, c.title, c.credits::float8 AS credits, pr.category, pr.group_label, pr.pick_count, pr.critical_path
    FROM program_requirements pr JOIN courses c ON c.id = pr.course_id
    WHERE pr.program_id = ${programId}
    ORDER BY pr.category, pr.group_label NULLS FIRST, c.code`) as any[];
  const groups = new Map<string, any>();
  for (const r of rows) {
    const key = r.group_label ?? r.category;
    const g = groups.get(key) ?? { requirement: key, category: r.category, pickCount: r.pick_count, courses: [] as any[] };
    g.courses.push({
      courseId: r.id, code: r.code, title: r.title, credits: r.credits, category: r.category,
      groupLabel: r.group_label, criticalPath: !!r.critical_path, isSlot: isSlot(r.code), inProgram: true,
    });
    groups.set(key, g);
  }
  // prerequisites that are not requirements of the major (a student may have taken them)
  const extraIds = outsidePrereqIds(await loadGraph(programId), new Set<number>(rows.map((r) => r.id)));
  if (extraIds.length) {
    const extra = (await sql`
      SELECT id, code, title, credits::float8 AS credits FROM courses WHERE id = ANY(${extraIds}::int[]) ORDER BY code`) as any[];
    groups.set("other_prerequisites", {
      requirement: "other_prerequisites", category: "prerequisite", pickCount: null,
      courses: extra.map((c) => ({
        courseId: c.id, code: c.code, title: c.title, credits: c.credits, category: "prerequisite",
        groupLabel: null, criticalPath: false, isSlot: false, inProgram: false,
      })),
    });
  }
  return {
    program: { id: program.id, name: program.name, degreeType: program.degree_type, catalogYear: program.catalog_year, totalCredits: degreeCredits(program.total_credits) },
    groups: [...groups.values()],
  };
}

// ---------------------------------------------------------------- courses taken (screens 4 and 5 save here)

type Row = { courseId: number; grade: string | null; termId: number | null };

export async function readHistory(studentId: number) {
  const ctx = await loadCtx(studentId);
  return {
    programId: ctx.student.program_id as number | null,
    courses: ctx.history.rows.map((h) => ({
      courseId: h.courseId, code: h.code, title: h.title, credits: h.credits, grade: h.grade,
      status: h.inProgress ? "in_progress" : h.passed ? "taken" : "not_passed", termCode: h.termCode,
    })),
  };
}

// PUT body: { programId?, mode?: "replace" | "merge", courses: [{ courseId, grade?, status?: "taken" | "in_progress", termCode? }] }
//   replace (default): the list becomes the student's whole history.   merge: only these courses are rewritten.
//   taken + no grade is saved as "P" (counts as passed, left out of the GPA). in_progress is saved with no grade.
export async function saveHistory(studentId: number, b: Record<string, any>) {
  const [stu] = (await sql`SELECT id FROM students WHERE id = ${studentId}`) as any[];
  if (!stu) throw new ApiError("student_not_found", "Student not found", 404);
  if (!Array.isArray(b.courses)) throw new ApiError("invalid_request", "courses must be a list", 400);
  if (b.courses.length > 200) throw new ApiError("invalid_request", "Too many courses", 400);
  const mode = b.mode === "merge" ? "merge" : "replace";

  let programId: number | null = null;
  if (b.programId != null) {
    programId = Number(b.programId);
    const [p] = Number.isInteger(programId) ? ((await sql`SELECT id FROM programs WHERE id = ${programId}`) as any[]) : [];
    if (!p) throw new ApiError("program_not_found", "Program not found", 404);
  }

  const terms = await allTerms();
  const planTerm = byCode(terms, PLAN_TERM);
  const current = planTerm ? currentTermOf(terms, planTerm) : null;

  const rows = new Map<number, Row>();
  for (const c of b.courses) {
    const courseId = Number(c?.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) throw new ApiError("invalid_request", "Each course needs a courseId", 400);
    const inProgress = c.status === "in_progress";
    if (c.status != null && c.status !== "taken" && !inProgress) throw new ApiError("invalid_request", "status must be 'taken' or 'in_progress'", 400, { courseId });
    let grade: string | null = null;
    if (inProgress) {
      if (c.grade != null && String(c.grade).trim() !== "") throw new ApiError("invalid_request", "A course in progress has no grade yet", 400, { courseId });
    } else {
      grade = c.grade == null || String(c.grade).trim() === "" ? "P" : String(c.grade).trim().toUpperCase();
      if (!VALID_GRADE.test(grade)) throw new ApiError("invalid_grade", `'${c.grade}' is not a grade we recognise`, 400, { courseId });
    }
    let termId: number | null = null;
    if (c.termCode != null && c.termCode !== "") {
      const t = byCode(terms, String(c.termCode));
      if (!t) throw new ApiError("term_not_found", `Unknown term '${c.termCode}'`, 400, { courseId });
      termId = t.id;
    } else if (inProgress) {
      termId = current?.id ?? null;
    }
    rows.set(courseId, { courseId, grade, termId });
  }

  const ids = [...rows.keys()];
  if (ids.length) {
    const found = (await sql`SELECT id FROM courses WHERE id = ANY(${ids}::int[])`) as any[];
    const have = new Set(found.map((r) => r.id));
    const missing = ids.filter((i) => !have.has(i));
    if (missing.length) throw new ApiError("course_not_found", "Some courses do not exist", 404, { courseIds: missing });
  }

  // One statement, so a failure cannot leave the student with half a history.
  const list = [...rows.values()];
  await sql`
    WITH del AS (
      DELETE FROM completed_courses
      WHERE student_id = ${studentId} AND (${mode === "replace"}::boolean OR course_id = ANY(${ids}::int[]))
      RETURNING 1
    ), upd AS (
      UPDATE students SET program_id = COALESCE(${programId}::int, program_id) WHERE id = ${studentId}
    )
    INSERT INTO completed_courses (student_id, course_id, term_id, grade)
    SELECT ${studentId}, u.course_id, u.term_id, u.grade
    FROM unnest(${list.map((r) => r.courseId)}::int[], ${list.map((r) => r.termId)}::int[], ${list.map((r) => r.grade)}::text[])
         AS u(course_id, term_id, grade)
    -- reading the delete's result makes the insert wait for it, so a re-saved course does not hit the unique key
    CROSS JOIN (SELECT COUNT(*) AS deleted FROM del) AS d`;

  const saved = await readHistory(studentId);
  const credits = (pred: (c: (typeof saved.courses)[number]) => boolean) =>
    saved.courses.filter(pred).reduce((s, c) => s + c.credits, 0);
  return {
    saved: saved.courses.length,
    programId: saved.programId,
    credits: { earned: credits((c) => c.status === "taken"), inProgress: credits((c) => c.status === "in_progress") },
    next: "board",
  };
}

// ---------------------------------------------------------------- the canvas (screen 2)

type BoardStatus = "taken" | "in_progress" | "planned" | "available" | "locked";

export async function getBoard(studentId: number) {
  const ctx = await loadCtx(studentId);
  const { student, terms, history, graph, catalog } = ctx;
  if (!student.program_id) throw new ApiError("no_program", "Pick a major first (PUT /api/students/:id/completed-courses with programId).", 409);

  const planId = await currentPlanId(studentId);
  const plan = planId ? await getPlan(planId) : null;
  const planItems = plan?.items ?? [];

  const reqs = (await sql`
    SELECT course_id, category, group_label, pick_count, critical_path
    FROM program_requirements WHERE program_id = ${student.program_id}`) as any[];
  const reqBy = new Map<number, any>(reqs.map((r) => [r.course_id, r]));
  const [prog] = (await sql`SELECT name, total_credits FROM programs WHERE id = ${student.program_id}`) as any[];
  const [gpaRow] = (await sql`SELECT gpa::float8 AS gpa FROM student_gpa WHERE student_id = ${studentId}`) as any[];

  // the row that describes where the student stands on a course: passed > in progress > latest attempt
  const histBy = new Map<number, HistoryRow>();
  for (const h of history.rows) {
    const prev = histBy.get(h.courseId);
    const rank = (x: HistoryRow) => (x.passed ? 3 : x.inProgress ? 2 : 1);
    if (!prev || rank(h) > rank(prev) || (rank(h) === rank(prev) && h.termKey > prev.termKey)) histBy.set(h.courseId, h);
  }
  const planBy = new Map<number, (typeof planItems)[number]>(planItems.map((i) => [i.courseId, i]));

  const ids = new Set<number>([...reqBy.keys(), ...outsidePrereqIds(graph, new Set(reqBy.keys())), ...histBy.keys(), ...planBy.keys()]);
  const codesOf = (group: number[]) => group.map((id) => catalog.get(id)?.code ?? String(id)).sort();

  const courses = [...ids]
    .filter((id) => catalog.has(id))
    .map((id) => {
      const c = catalog.get(id)!;
      const h = histBy.get(id);
      const pi = planBy.get(id);
      const ps = prereqStatus(graph, id, history);
      const r = reqBy.get(id);
      const status: BoardStatus = h?.passed ? "taken" : h?.inProgress ? "in_progress" : pi ? "planned" : ps.status === "available" ? "available" : "locked";
      const histTerm = h && (h.passed || h.inProgress) ? (h.termId ? byId(terms, h.termId) : h.inProgress ? ctx.current : null) : null;
      return {
        courseId: id,
        code: c.code,
        title: c.title,
        credits: c.credits,
        category: r?.category ?? "prerequisite",
        groupLabel: r?.group_label ?? null,
        pickCount: r?.pick_count ?? null,
        criticalPath: !!r?.critical_path,
        isSlot: isSlot(c.code),
        inProgram: !!r,
        status,
        prereq: ps.status, // available | needs | locked (raw prerequisite state)
        needs: ps.waiting.map((w) => fmtGroup(codesOf(w.ids))),
        termCode: status === "planned" ? pi!.termCode : histTerm?.code ?? null,
        grade: h?.grade ?? null,
        retake: !!h && !h.passed && !h.inProgress,
        planItemId: pi?.id ?? null,
        suggested: !!pi?.suggested,
        confirmed: pi?.confirmed ?? null,
        issues: (pi?.issues ?? []).filter((i) => !SEAT_ISSUES.has(i.type)),
        override: pi?.override ?? null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  // ---- columns: every term that has a course, plus the next term so there is always somewhere to drop
  const termIds = new Set<number>([ctx.planTerm.id]);
  for (const c of courses) if (c.termCode) { const t = byCode(terms, c.termCode); if (t) termIds.add(t.id); }
  const columns = terms
    .filter((t) => termIds.has(t.id))
    .map((t) => {
      const here = courses.filter((c) => c.termCode === t.code && ["taken", "in_progress", "planned"].includes(c.status));
      const state = t.key < ctx.currentKey ? "completed" : t.key === ctx.currentKey ? "current" : "planned";
      return {
        code: t.code, name: t.name, state, now: state === "current",
        label: state === "completed" ? "Completed" : state === "current" ? "In progress" : t.id === ctx.planTerm.id ? "Up next" : "Later",
        credits: here.reduce((s, c) => s + c.credits, 0), courses: here.length,
      };
    });

  // ---- prerequisite lines (only between notes on the board)
  const onBoard = new Set(courses.map((c) => c.courseId));
  const edges: { from: number; to: number; group: number }[] = [];
  for (const c of courses)
    (graph.get(c.courseId) ?? []).forEach((group, gi) => {
      for (const from of group) if (onBoard.has(from)) edges.push({ from, to: c.courseId, group: gi + 1 });
    });

  // ---- top bar numbers
  const uniq = (pred: (c: (typeof courses)[number]) => boolean) => courses.filter(pred).reduce((s, c) => s + c.credits, 0);
  const total = degreeCredits(prog?.total_credits);
  const earned = uniq((c) => c.status === "taken");
  const inProgress = uniq((c) => c.status === "in_progress");
  const planned = uniq((c) => c.status === "planned");
  const remaining = Math.max(0, total - earned);

  return {
    student: { id: student.id, name: student.display_name, programId: student.program_id, programName: prog?.name ?? student.program_name },
    header: {
      gpa: gpaRow?.gpa ?? null,
      creditsCompleted: earned,
      creditsInProgress: inProgress,
      creditsPlanned: planned,
      creditsTotal: total,
      creditsRemaining: remaining,
      projectedGraduation: projectGraduation(ctx, total - earned - inProgress - planned, columns, student.target_credits),
      currentTerm: ctx.current ? { code: ctx.current.code, name: ctx.current.name } : null,
      planTerm: { code: ctx.planTerm.code, name: ctx.planTerm.name },
    },
    plan: plan
      ? { id: plan.plan.id, status: plan.plan.status, readOnly: plan.readOnly, createdBy: plan.plan.createdBy, approvedBy: plan.plan.approvedBy, blocking: plan.blockingIssues.filter((i) => !SEAT_ISSUES.has(i.type)).length }
      : null,
    // A student can change the board unless the plan is approved (editing one in review sends it back to draft).
    editable: !plan || plan.plan.status === "draft" || plan.plan.status === "in_review",
    terms: columns,
    courses,
    edges,
    totals: { target: student.target_credits, byTerm: columns.filter((c) => c.state === "planned").map((c) => ({ code: c.code, credits: c.credits })) },
  };
}

// Projected graduation: the last term with a planned course once the plan covers every remaining credit,
// otherwise extra terms at the student's target load after the last planned term (summer skipped).
function projectGraduation(ctx: Awaited<ReturnType<typeof loadCtx>>, creditsLeft: number, columns: { code: string; state: string; courses: number }[], target: number) {
  const lastUsed = [...columns].reverse().find((c) => c.courses > 0);
  const used = lastUsed ? byCode(ctx.terms, lastUsed.code) : null;
  // count forward from the later of "last term with a course" and "the term the student is in now"
  const lastTerm = used && (!ctx.current || used.key > ctx.current.key) ? used : ctx.current ?? used;
  if (!lastTerm) return null;
  if (creditsLeft <= 0) return { code: lastTerm.code, name: lastTerm.name };
  const extra = Math.ceil(creditsLeft / Math.max(1, target || 15));
  const t = termsAfter(ctx.terms, lastTerm.key, extra)[extra - 1];
  return t ? { code: t.code, name: t.name } : null;
}

// ---------------------------------------------------------------- course side panel (screens 3 and 8)

export async function courseDetail(studentId: number, courseId: number, termCode?: string) {
  const ctx = await loadCtx(studentId);
  const { catalog, graph, history, terms } = ctx;
  const course = catalog.get(courseId);
  if (!course) throw new ApiError("course_not_found", "Course not found", 404);

  const planId = await currentPlanId(studentId);
  const plan = planId ? await getPlan(planId) : null;
  const planned = new Map<number, string>((plan?.items ?? []).map((i) => [i.courseId, i.termCode]));
  const stateOf = (id: number) =>
    history.passed.has(id) ? "passed" : history.inProgress.has(id) ? "in_progress" : planned.has(id) ? "planned" : "not_started";
  const brief = (id: number) => ({ courseId: id, code: catalog.get(id)?.code ?? String(id), title: catalog.get(id)?.title ?? "", state: stateOf(id) });

  const prerequisites = (graph.get(courseId) ?? []).map((group) => ({
    options: group.map(brief),
    met: group.some((id) => history.passed.has(id)),
  }));

  const [req] = (await sql`
    SELECT category, group_label FROM program_requirements WHERE program_id = ${ctx.student.program_id} AND course_id = ${courseId}`) as any[];

  // what this course leads to, inside the student's program
  const programIds = new Set<number>(
    ((await sql`SELECT course_id FROM program_requirements WHERE program_id = ${ctx.student.program_id}`) as any[]).map((r) => r.course_id)
  );
  const unlocks: any[] = [];
  for (const [other, groups] of graph) {
    const gi = groups.findIndex((g) => g.includes(courseId));
    if (gi < 0 || !programIds.has(other) || !catalog.has(other)) continue;
    // taking this course "opens up" the other one when its remaining groups are already covered
    const covered = groups.every((g, i) => i === gi || g.some((id) => stateOf(id) !== "not_started"));
    unlocks.push({ ...brief(other), credits: catalog.get(other)!.credits, opensUp: covered && stateOf(other) === "not_started" });
  }
  unlocks.sort((a, b) => a.code.localeCompare(b.code));

  const status: BoardStatus = history.passed.has(courseId)
    ? "taken"
    : history.inProgress.has(courseId)
      ? "in_progress"
      : planned.has(courseId)
        ? "planned"
        : prereqStatus(graph, courseId, history).status === "available"
          ? "available"
          : "locked";

  let addTo: any = null;
  if (status === "available" || status === "locked") {
    const t = termCode ? byCode(terms, termCode) : ctx.planTerm;
    if (!t) throw new ApiError("term_not_found", `Unknown term '${termCode}'`, 400);
    const chk = await checkAdditionFor(studentId, planId, courseId, { termCode: t.code, ignoreSeats: true });
    if (chk.found)
      addTo = {
        termCode: chk.term.code, termName: chk.term.name, allowed: !chk.blocking,
        problems: chk.problems, missing: chk.missing, blockingCourse: chk.blockingCourse, suggestedTerm: chk.suggestedTerm,
      };
  }

  const professors = (await sql`
    SELECT name, rating::float8 AS rating, rating_count, difficulty::float8 AS difficulty, source_url
    FROM course_professors WHERE course_id = ${courseId} ORDER BY rating DESC NULLS LAST, name`) as any[];
  const threads = (await sql`
    SELECT title, url, source, replies, posted_at FROM course_threads WHERE course_id = ${courseId}
    ORDER BY posted_at DESC NULLS LAST, id DESC LIMIT 10`) as any[];

  return {
    course: { courseId, code: course.code, title: course.title, credits: course.credits, category: req?.category ?? null, groupLabel: req?.group_label ?? null },
    status,
    plannedIn: planned.get(courseId) ?? null,
    prerequisites,
    unlocks,
    addTo,
    professors: professors.map((p) => ({ name: p.name, rating: p.rating, ratingCount: p.rating_count, difficulty: p.difficulty, url: p.source_url })),
    threads: threads.map((t) => ({ title: t.title, url: t.url, source: t.source, replies: t.replies, postedAt: t.posted_at })),
  };
}

// ---------------------------------------------------------------- student edits (screens 6, 7, 8)
// These reuse the advisor edit code (same checks, same 422 check_failed payload). The student is the actor,
// can never force an override, and cannot edit an approved or in-review plan.

const asStudent = (studentId: number, b: Record<string, any>): Record<string, any> => ({ ...b, __studentId: studentId, force: false, advisorId: undefined });

async function assertStudent(studentId: number) {
  const [s] = (await sql`SELECT id FROM students WHERE id = ${studentId}`) as any[];
  if (!s) throw new ApiError("student_not_found", "Student not found", 404);
}

// POST body: { courseId, termCode?, dryRun? }
export async function studentAdd(studentId: number, b: Record<string, any>) {
  await assertStudent(studentId);
  const body = asStudent(studentId, b);
  const existing = await currentPlanId(studentId);
  if (!existing && body.dryRun) {
    const courseId = Number(body.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) return failCode("invalid_request", "courseId is required", 400);
    const check = await checkAdditionFor(studentId, null, courseId, { termCode: typeof body.termCode === "string" ? body.termCode : undefined, ignoreSeats: true });
    if (!check.found) return failCode("course_not_found", "Course not found", 404);
    return ok({ dryRun: true, ...check });
  }
  const planId = existing ?? (await ensurePlan(studentId));
  // A first add that fails must not leave an empty "student plan" behind (advisors would see a plan that is not there).
  let res: Response | undefined;
  try {
    res = await addCourse(planId, body);
    return res;
  } finally {
    if (!existing && !(res && res.status < 300)) await sql`DELETE FROM plans WHERE id = ${planId}`;
  }
}

// PATCH body: { termCode, dryRun? }
export async function studentMove(studentId: number, courseId: number, b: Record<string, any>) {
  await assertStudent(studentId);
  const planId = await currentPlanId(studentId);
  if (!planId) return itemNotFound();
  const it = await findItem(planId, courseId);
  if (!it) return itemNotFound();
  return moveItem(planId, it.id, asStudent(studentId, b));
}

export async function studentRemove(studentId: number, courseId: number) {
  await assertStudent(studentId);
  const planId = await currentPlanId(studentId);
  if (!planId) return itemNotFound();
  const it = await findItem(planId, courseId);
  if (!it) return itemNotFound();
  return removeItem(planId, it.id, { type: "student", id: studentId });
}

export async function studentRestore(studentId: number, courseId: number) {
  await assertStudent(studentId);
  const planId = await currentPlanId(studentId);
  if (!planId) return failCode("nothing_to_restore", "There is no removed copy of that course to restore", 404);
  return restoreCourse(planId, courseId, { type: "student", id: studentId });
}
