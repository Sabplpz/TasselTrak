import { sql } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { PLAN_TERM } from "@/lib/plan";

// GET /api/demand?term=spring-2027 -> seat-demand panel: planned students vs. seats left
export async function GET(req: Request) {
  const term = new URL(req.url).searchParams.get("term") || PLAN_TERM;
  try {
    const rows = (await sql`
      SELECT d.course_id, d.code, d.title, d.planned_students::int,
             d.total_capacity::int, d.total_enrolled::int,
             (d.total_capacity - d.total_enrolled)::int AS seats_open,
             d.seat_shortfall::int
      FROM course_demand d JOIN terms t ON t.id = d.term_id
      WHERE t.code = ${term} AND d.code !~ '^(GEP|ELEC) '
      ORDER BY d.seat_shortfall DESC, d.planned_students DESC, d.code`) as any[];
    const courses = rows.map((r) => ({
      ...r,
      status: r.seat_shortfall > 0 ? "over" : r.seats_open - r.planned_students <= 3 ? "tight" : "ok",
    }));
    return ok({ term, courses, over: courses.filter((c) => c.status === "over").length });
  } catch (e) {
    return serverError(e);
  }
}
