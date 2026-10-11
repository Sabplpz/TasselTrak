import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId } from "@/lib/api";
import { PLAN_TERM } from "@/lib/plan";
import { standingOf } from "@/lib/risk";

// GET /api/demand/:courseId/students?term=spring-2027&limit=8&offset=0
// The side panel on the seat-demand page: students who have this course on a live plan in that term.
export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const courseId = toId((await params).courseId);
  if (!courseId) return failCode("invalid_request", "Invalid course id", 400);
  const u = new URL(req.url);
  const term = u.searchParams.get("term") || PLAN_TERM;
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 8) || 8, 1), 100);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  try {
    const [course] = (await sql`SELECT id, code, title FROM courses WHERE id = ${courseId}`) as any[];
    if (!course) return failCode("course_not_found", "Course not found", 404);

    const [rows, [{ n }]] = await Promise.all([
      sql`
        SELECT s.id AS student_id, s.display_name, p.name AS program_name,
               COALESCE(o.credits_earned, 0)::float8 AS credits_earned, pl.status AS plan_status
        FROM plan_items pi
        JOIN plans pl ON pl.id = pi.plan_id AND pl.status <> 'archived'
        JOIN terms t ON t.id = pi.term_id AND t.code = ${term}
        JOIN students s ON s.id = pl.student_id
        LEFT JOIN programs p ON p.id = s.program_id
        LEFT JOIN student_overview o ON o.student_id = s.id
        WHERE pi.course_id = ${courseId}
        ORDER BY s.display_name
        LIMIT ${limit} OFFSET ${offset}`,
      sql`
        SELECT COUNT(*)::int AS n
        FROM plan_items pi
        JOIN plans pl ON pl.id = pi.plan_id AND pl.status <> 'archived'
        JOIN terms t ON t.id = pi.term_id AND t.code = ${term}
        WHERE pi.course_id = ${courseId}`,
    ]);
    return ok({
      course,
      term,
      total: n,
      students: (rows as any[]).map((r) => ({
        student_id: r.student_id,
        display_name: r.display_name,
        program_name: r.program_name,
        class_standing: standingOf(r.credits_earned),
        plan_status: r.plan_status,
      })),
      page: { limit, offset, total: n },
    });
  } catch (e) {
    return serverError(e);
  }
}
