import { sql } from "@/lib/db";
import { ok, serverError, toId } from "@/lib/api";

// GET /api/caseload?advisorId=1 -> caseload list with status badges
export async function GET(req: Request) {
  const advisorId = toId(new URL(req.url).searchParams.get("advisorId"));
  try {
    const rows = (await sql`
      SELECT o.student_id, o.display_name, s.external_id, o.advisor_id, o.program_id,
             p.name AS program_name, o.credits_earned::float8 AS credits_earned, o.credits_in_progress::float8 AS credits_in_progress,
             o.open_flags::int AS open_flags, o.top_flag_severity, o.risk_score::float8 AS risk_score, o.risk_level,
             s.target_credits, lp.id AS plan_id, lp.status AS plan_status
      FROM student_overview o
      JOIN students s ON s.id = o.student_id
      LEFT JOIN programs p ON p.id = o.program_id
      LEFT JOIN LATERAL (
        SELECT id, status FROM plans
        WHERE student_id = o.student_id AND status <> 'archived'
        ORDER BY created_at DESC LIMIT 1
      ) lp ON TRUE
      WHERE (${advisorId}::int IS NULL OR o.advisor_id = ${advisorId}::int)
      ORDER BY o.open_flags DESC, o.display_name`) as any[];

    const summary = {
      total: rows.length,
      needs_attention: rows.filter((r) => r.open_flags > 0).length,
      no_plan: rows.filter((r) => !r.plan_id).length,
      in_review: rows.filter((r) => r.plan_status === "draft" || r.plan_status === "in_review").length,
      approved: rows.filter((r) => r.plan_status === "approved").length,
    };
    return ok({ students: rows, summary });
  } catch (e) {
    return serverError(e);
  }
}
