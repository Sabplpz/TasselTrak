import { sql } from "@/lib/db";
import { ok, fail, serverError, toId, readJson } from "@/lib/api";
import { checkAddition, getPlan, logEvent, touchPlan } from "@/lib/plan";

// POST /api/plans/:id/items { courseId, reason?, advisorId?, dryRun?, force? }
// Adds a course. dryRun=true only runs the prerequisite/seat/time checks.
// Blocking problems return 422 unless force=true (recorded as an advisor override).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return fail("Invalid plan id");
  const b = await readJson(req);
  const courseId = toId(String(b.courseId ?? ""));
  if (!courseId) return fail("courseId is required");
  try {
    const check = await checkAddition(planId, courseId);
    if (!check.found) return fail("Course not found", 404);
    if (b.dryRun) return ok({ dryRun: true, ...check, section: check.section });
    if (check.blocking && !b.force) return fail("Check failed", 422, { problems: check.problems, missing: check.missing });

    await sql`INSERT INTO plan_items (plan_id, term_id, course_id, section_id, reason, source)
              VALUES (${planId}, ${check.termId}, ${courseId}, ${check.section?.id ?? null},
                      ${typeof b.reason === "string" && b.reason ? b.reason : "Added by advisor."}, 'advisor')`;
    const advisorId = toId(String(b.advisorId ?? ""));
    await logEvent(planId, advisorId, "added_course", { code: check.course.code, forced: !!(b.force && check.blocking), problems: check.problems.map((p) => p.message) });
    await touchPlan(planId);
    return ok(await getPlan(planId), 201);
  } catch (e) {
    return serverError(e);
  }
}
