import { sql } from "@/lib/db";
import { ok, failCode, serverError } from "@/lib/api";
import { PLAN_TERM } from "@/lib/plan";

// GET /api/demand?term=spring-2027&sort=shortfall_desc&limit=10&offset=0
// Seat-demand page (A8): planned students vs. seats, per course, for one term.
// sort: shortfall_desc (default) | planned_desc | code
// `terms` fills the term picker (terms that have a schedule or a planned course).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const term = u.searchParams.get("term") || PLAN_TERM;
  const sortParam = u.searchParams.get("sort") ?? "shortfall_desc";
  const sort = ["shortfall_desc", "planned_desc", "code"].includes(sortParam) ? sortParam : "shortfall_desc";
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 10) || 10, 1), 100);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  try {
    const [exists] = (await sql`SELECT 1 FROM terms WHERE code = ${term}`) as any[];
    if (!exists) return failCode("term_not_found", `Unknown term '${term}'`, 404);

    const terms = (await sql`
      SELECT t.code, t.name FROM terms t
      WHERE t.id IN (SELECT term_id FROM sections UNION SELECT term_id FROM plan_items)
      ORDER BY t.year, CASE t.season WHEN 'spring' THEN 1 WHEN 'summer' THEN 2 ELSE 3 END`) as any[];

    const rows = (await sql`
      SELECT d.course_id, d.code, d.title, d.planned_students::int,
             d.total_capacity::int AS seats_total, d.total_capacity::int, d.total_enrolled::int,
             (d.total_capacity - d.total_enrolled)::int AS seats_open,
             d.seat_shortfall::int
      FROM course_demand d JOIN terms t ON t.id = d.term_id
      WHERE t.code = ${term} AND d.code !~ '^(GEP|ELEC) '
      ORDER BY CASE WHEN ${sort}::text = 'code' THEN d.code END ASC,
               CASE WHEN ${sort}::text = 'planned_desc' THEN d.planned_students END DESC,
               d.seat_shortfall DESC, d.planned_students DESC, d.code`) as any[];
    const courses = rows.map((r) => ({
      ...r,
      status: r.seat_shortfall > 0 ? "over" : r.seats_open - r.planned_students <= 3 ? "tight" : "ok",
    }));
    return ok({
      term,
      terms,
      courses: courses.slice(offset, offset + limit),
      over: courses.filter((c) => c.status === "over").length,
      page: { limit, offset, total: courses.length },
    });
  } catch (e) {
    return serverError(e);
  }
}
