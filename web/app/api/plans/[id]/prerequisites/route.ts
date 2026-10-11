import { sql } from "@/lib/db";
import { ok, fail, serverError, toId } from "@/lib/api";

// GET /api/plans/:id/prerequisites -> prerequisite edges for the plan's student's program (read only).
// One row per "course needs required course". Rows that share a groupNo are alternatives (any one
// of them satisfies the group); a course needs every group.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return fail("Invalid plan id");
  try {
    const [plan] = await sql`
      SELECT p.id, s.program_id
      FROM plans p JOIN students s ON s.id = p.student_id
      WHERE p.id = ${id}`;
    if (!plan) return fail("Plan not found", 404);

    // Courses the program requires, plus anything already in this plan.
    const rows = await sql`
      SELECT pr.course_id AS "courseId", c.code AS "courseCode",
             pr.required_course_id AS "requiredCourseId", rc.code AS "requiredCode",
             pr.kind, pr.group_no AS "groupNo", pr.min_grade AS "minGrade"
      FROM prerequisites pr
      JOIN courses c ON c.id = pr.course_id
      JOIN courses rc ON rc.id = pr.required_course_id
      WHERE pr.course_id IN (
              SELECT course_id FROM program_requirements WHERE program_id = ${plan.program_id}
              UNION
              SELECT course_id FROM plan_items WHERE plan_id = ${id})
      ORDER BY c.code, pr.kind, pr.group_no, rc.code`;
    return ok({ prerequisites: rows });
  } catch (e) {
    return serverError(e);
  }
}
