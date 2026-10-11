import { sql } from "@/lib/db";
import { ok, failCode, toId, ApiError } from "@/lib/api";
import { assertEditable, checkAddition, getAdvisor, getPlan, logEvent, touchPlan } from "@/lib/plan";

type Body = Record<string, any>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function findItem(planId: number, courseId: number) {
  const [it] = (await sql`
    SELECT pi.id, pi.course_id, pi.term_id, pi.section_id, pi.reason, pi.source, pi.confirmed,
           pi.override_by, pi.override_note, c.code, c.title, t.code AS term_code
    FROM plan_items pi JOIN courses c ON c.id = pi.course_id JOIN terms t ON t.id = pi.term_id
    WHERE pi.plan_id = ${planId} AND pi.course_id = ${courseId}
    ORDER BY t.year, t.id LIMIT 1`) as any[];
  return it as
    | { id: number; course_id: number; term_id: number; section_id: number | null; reason: string | null; source: string;
        confirmed: boolean; override_by: number | null; override_note: string | null; code: string; title: string; term_code: string }
    | undefined;
}

export const itemNotFound = () => failCode("item_not_found", "That course is not in this plan", 404);

function checkFailed(check: any) {
  return failCode("check_failed", "Check failed", 422, {
    problems: check.problems,
    missing: check.missing,
    blockingCourse: check.blockingCourse,
    suggestedTerm: check.suggestedTerm,
    term: check.term,
  });
}

// A forced edit is an override: it needs an authorized advisor and leaves the Override tag.
async function overrideFor(b: Body, blocking: boolean, why: string) {
  if (!(blocking && b.force)) return { by: null as number | null, note: null as string | null };
  const advisor = await getAdvisor(toId(String(b.advisorId ?? "")));
  if (!advisor) throw new ApiError("advisor_required", "advisorId is required to override a problem", 400);
  if (!advisor.can_override) throw new ApiError("not_authorized", "This advisor is not authorized to override problems", 403);
  return { by: advisor.id, note: str(b.note) ?? str(b.reason) ?? why };
}

// ---------------------------------------------------------------- add

export async function addCourse(planId: number, b: Body) {
  const courseId = toId(String(b.courseId ?? ""));
  if (!courseId) return failCode("invalid_request", "courseId is required", 400);
  if (!b.dryRun) await assertEditable(planId);
  const check = await checkAddition(planId, courseId, { termCode: str(b.termCode) });
  if (!check.found) return failCode("course_not_found", "Course not found", 404);
  if (b.dryRun) return ok({ dryRun: true, ...check });
  if (check.blocking && !b.force) return checkFailed(check);

  const ov = await overrideFor(b, check.blocking, "Added with an override.");
  await sql`
    INSERT INTO plan_items (plan_id, term_id, course_id, section_id, reason, source, confirmed, override_by, override_note, override_at)
    VALUES (${planId}, ${check.termId}, ${courseId}, ${check.section?.id ?? null},
            ${str(b.reason) ?? "Added by advisor."}, 'advisor', TRUE,
            ${ov.by}, ${ov.note}, CASE WHEN ${ov.by}::int IS NULL THEN NULL ELSE NOW() END)`;
  await logEvent(planId, toId(String(b.advisorId ?? "")), "added_course", {
    code: check.course.code, courseId, termCode: check.term.code, forced: !!ov.by, problems: check.problems.map((p) => p.message),
  });
  await touchPlan(planId);
  return ok({ ...(await getPlan(planId)), added: { courseId, code: check.course.code, termCode: check.term.code } }, 201);
}

// ---------------------------------------------------------------- swap

export async function swapItem(planId: number, itemId: number, b: Body) {
  const newId = toId(String(b.newCourseId ?? b.courseId ?? ""));
  if (!newId) return failCode("invalid_request", "newCourseId is required", 400);
  const [item] = (await sql`
    SELECT pi.id, c.code, t.code AS term_code FROM plan_items pi
    JOIN courses c ON c.id = pi.course_id JOIN terms t ON t.id = pi.term_id
    WHERE pi.id = ${itemId} AND pi.plan_id = ${planId}`) as any[];
  if (!item) return itemNotFound();
  if (!b.dryRun) await assertEditable(planId);

  const check = await checkAddition(planId, newId, { replaceItemId: itemId, termCode: item.term_code });
  if (!check.found) return failCode("course_not_found", "Course not found", 404);
  if (b.dryRun) return ok({ dryRun: true, replaces: item.code, ...check });
  if (check.blocking && !b.force) return checkFailed(check);

  const ov = await overrideFor(b, check.blocking, `Swapped in with an override for ${item.code}.`);
  await sql`UPDATE plan_items SET course_id = ${newId}, section_id = ${check.section?.id ?? null},
            reason = ${str(b.reason) ?? `Swapped in by advisor for ${item.code}.`},
            source = 'advisor', confirmed = TRUE,
            override_by = ${ov.by}, override_note = ${ov.note},
            override_at = CASE WHEN ${ov.by}::int IS NULL THEN NULL ELSE NOW() END
            WHERE id = ${itemId}`;
  await logEvent(planId, toId(String(b.advisorId ?? "")), "swapped_course", {
    from: item.code, to: check.course.code, termCode: item.term_code, forced: !!ov.by, problems: check.problems.map((x) => x.message),
  });
  await touchPlan(planId);
  return ok(await getPlan(planId));
}

// ---------------------------------------------------------------- move to another term

export async function moveItem(planId: number, itemId: number, b: Body) {
  const termCode = str(b.termCode);
  if (!termCode) return failCode("invalid_request", "termCode is required", 400);
  const [item] = (await sql`
    SELECT pi.id, pi.course_id, c.code, t.code AS term_code FROM plan_items pi
    JOIN courses c ON c.id = pi.course_id JOIN terms t ON t.id = pi.term_id
    WHERE pi.id = ${itemId} AND pi.plan_id = ${planId}`) as any[];
  if (!item) return itemNotFound();
  if (!b.dryRun) await assertEditable(planId);

  const check = await checkAddition(planId, item.course_id, { replaceItemId: itemId, termCode });
  if (!check.found) return failCode("course_not_found", "Course not found", 404);
  if (b.dryRun) return ok({ dryRun: true, moves: item.code, ...check });
  if (check.blocking && !b.force) return checkFailed(check);

  const ov = await overrideFor(b, check.blocking, `Moved to ${check.term.name} with an override.`);
  await sql`UPDATE plan_items SET term_id = ${check.termId}, section_id = ${check.section?.id ?? null}, confirmed = TRUE,
            override_by = COALESCE(${ov.by}, override_by), override_note = COALESCE(${ov.note}, override_note),
            override_at = CASE WHEN ${ov.by}::int IS NULL THEN override_at ELSE NOW() END
            WHERE id = ${itemId}`;
  await logEvent(planId, toId(String(b.advisorId ?? "")), "moved_course", {
    code: item.code, courseId: item.course_id, from: item.term_code, to: check.term.code, forced: !!ov.by,
  });
  await touchPlan(planId);
  return ok({ ...(await getPlan(planId)), moved: { courseId: item.course_id, code: item.code, from: item.term_code, to: check.term.code } });
}

// ---------------------------------------------------------------- remove + undo

export async function removeItem(planId: number, itemId: number, advisorId: number | null) {
  await assertEditable(planId);
  const [row] = (await sql`
    SELECT pi.id, pi.course_id, pi.term_id, pi.section_id, pi.reason, pi.source, pi.confirmed,
           pi.override_by, pi.override_note, c.code, t.code AS term_code
    FROM plan_items pi JOIN courses c ON c.id = pi.course_id JOIN terms t ON t.id = pi.term_id
    WHERE pi.id = ${itemId} AND pi.plan_id = ${planId}`) as any[];
  if (!row) return itemNotFound();
  await sql`DELETE FROM plan_items WHERE id = ${itemId}`;
  // The snapshot is what "Undo" restores.
  await logEvent(planId, advisorId, "removed_course", {
    code: row.code, courseId: row.course_id, termId: row.term_id, termCode: row.term_code, sectionId: row.section_id,
    reason: row.reason, source: row.source, confirmed: row.confirmed, overrideBy: row.override_by, overrideNote: row.override_note,
  });
  await touchPlan(planId);
  return ok({ ...(await getPlan(planId)), removed: { courseId: row.course_id, code: row.code, termCode: row.term_code } });
}

export async function restoreCourse(planId: number, courseId: number, advisorId: number | null) {
  await assertEditable(planId);
  const [ev] = (await sql`
    SELECT e.id, e.detail FROM plan_events e
    WHERE e.plan_id = ${planId} AND e.action = 'removed_course' AND (e.detail->>'courseId')::int = ${courseId}
      AND NOT EXISTS (SELECT 1 FROM plan_events r
                      WHERE r.plan_id = e.plan_id AND r.action = 'restored_course'
                        AND (r.detail->>'courseId')::int = ${courseId} AND r.id > e.id)
    ORDER BY e.id DESC LIMIT 1`) as any[];
  if (!ev) return failCode("nothing_to_restore", "There is no removed copy of that course to restore", 404);
  if (await findItem(planId, courseId)) return failCode("already_in_plan", "That course is already back in the plan", 409);

  const d = ev.detail;
  const [{ n }] = (await sql`SELECT COUNT(*)::int AS n FROM sections WHERE id = ${d.sectionId ?? 0}`) as any[];
  await sql`
    INSERT INTO plan_items (plan_id, term_id, course_id, section_id, reason, source, confirmed, override_by, override_note, override_at)
    VALUES (${planId}, ${d.termId}, ${courseId}, ${n ? d.sectionId : null}, ${d.reason ?? null}, ${d.source ?? "advisor"},
            ${!!d.confirmed}, ${d.overrideBy ?? null}, ${d.overrideNote ?? null},
            CASE WHEN ${d.overrideBy ?? null}::int IS NULL THEN NULL ELSE NOW() END)`;
  await logEvent(planId, advisorId, "restored_course", { code: d.code, courseId, termCode: d.termCode });
  await touchPlan(planId);
  return ok({ ...(await getPlan(planId)), restored: { courseId, code: d.code, termCode: d.termCode } });
}

// ---------------------------------------------------------------- confirm + override

// "Suggested" -> confirmed. This acknowledges a suggestion; it does not change the plan's content,
// so it does not send a plan in review back to draft.
export async function confirmItem(planId: number, courseId: number, advisorId: number | null) {
  await assertEditable(planId);
  const it = await findItem(planId, courseId);
  if (!it) return itemNotFound();
  await sql`UPDATE plan_items SET confirmed = TRUE WHERE id = ${it.id}`;
  await logEvent(planId, advisorId, "confirmed_course", { code: it.code, courseId, termCode: it.term_code });
  return ok(await getPlan(planId));
}

// Approve a course despite a blocking problem, with a written reason.
export async function overrideItem(planId: number, courseId: number, b: Body) {
  await assertEditable(planId);
  const advisor = await getAdvisor(toId(String(b.advisorId ?? "")));
  if (!advisor) return failCode("advisor_required", "advisorId is required", 400);
  if (!advisor.can_override) return failCode("not_authorized", "This advisor is not authorized to override problems", 403);
  const note = str(b.note);
  if (!note) return failCode("note_required", "A written reason is required to override a problem", 400);
  const it = await findItem(planId, courseId);
  if (!it) return itemNotFound();

  const plan = await getPlan(planId);
  const item = plan?.items.find((i) => i.courseId === courseId);
  if (!item?.issues.some((i) => i.severity === "high" && !i.overridden))
    return failCode("nothing_to_override", "That course has no blocking problem to override", 409);

  await sql`UPDATE plan_items SET override_by = ${advisor.id}, override_note = ${note}, override_at = NOW() WHERE id = ${it.id}`;
  await logEvent(planId, advisor.id, "override", {
    code: it.code, courseId, termCode: it.term_code, note, issues: item.issues.filter((i) => i.severity === "high").map((i) => i.message),
  });
  await touchPlan(planId);
  return ok(await getPlan(planId));
}
