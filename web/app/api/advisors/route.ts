import { sql } from "@/lib/db";
import { ok, serverError } from "@/lib/api";

// GET /api/advisors -> advisor picker (no real auth in the demo)
// can_override: whether this advisor may override a blocking problem (migration 003).
export async function GET() {
  try {
    const rows = await sql`
      SELECT a.id, a.name, a.email, a.department, a.can_override, COUNT(s.id)::int AS students
      FROM advisors a LEFT JOIN students s ON s.advisor_id = a.id
      GROUP BY a.id ORDER BY a.name`;
    return ok({ advisors: rows });
  } catch (e) {
    return serverError(e);
  }
}
