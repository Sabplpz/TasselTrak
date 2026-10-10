import { sql } from "@/lib/db";
import { ok, fail, serverError, toId, readJson } from "@/lib/api";
import { checkAddition, getPlan, logEvent, touchPlan } from "@/lib/plan";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

// PUT /api/plans/:id/items/:itemId { courseId, reason?, advisorId?, dryRun?, force? }
// Swap this item for another course. Prerequisites, seats and time conflicts are re-checked.
export async function PUT(req: Request, { params }: Ctx) {
  const p = await params;
  const planId = toId(p.id), itemId = toId(p.itemId);
  if (!planId || !itemId) return fail("Invalid id");
  const b = await readJson(req);
  const courseId = toId(String(b.courseId ?? ""));
  if (!courseId) return fail("courseId is required");
  try {
    const [item] = (await sql`
      SELECT pi.id, c.code FROM plan_items pi JOIN courses c ON c.id = pi.course_id
      WHERE pi.id = ${itemId} AND pi.plan_id = ${planId}`) as any[];
    if (!item) return fail("Plan item not found", 404);

    const check = await checkAddition(planId, courseId, itemId);
    if (!check.found) return fail("Course not found", 404);
    if (b.dryRun) return ok({ dryRun: true, replaces: item.code, ...check });
    if (check.blocking && !b.force) return fail("Check failed", 422, { problems: check.problems, missing: check.missing });

    await sql`UPDATE plan_items SET course_id = ${courseId}, section_id = ${check.section?.id ?? null},
              reason = ${typeof b.reason === "string" && b.reason ? b.reason : `Swapped in by advisor for ${item.code}.`},
              source = 'advisor'
              WHERE id = ${itemId}`;
    await logEvent(planId, toId(String(b.advisorId ?? "")), "swapped_course", {
      from: item.code, to: check.course.code, forced: !!(b.force && check.blocking),
      problems: check.problems.map((x) => x.message),
    });
    await touchPlan(planId);
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/plans/:id/items/:itemId?advisorId=
export async function DELETE(req: Request, { params }: Ctx) {
  const p = await params;
  const planId = toId(p.id), itemId = toId(p.itemId);
  if (!planId || !itemId) return fail("Invalid id");
  try {
    const [gone] = (await sql`
      DELETE FROM plan_items pi USING courses c
      WHERE pi.id = ${itemId} AND pi.plan_id = ${planId} AND c.id = pi.course_id
      RETURNING c.code`) as any[];
    if (!gone) return fail("Plan item not found", 404);
    await logEvent(planId, toId(new URL(req.url).searchParams.get("advisorId")), "removed_course", { code: gone.code });
    await touchPlan(planId);
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
