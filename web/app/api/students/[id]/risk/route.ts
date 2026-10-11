import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId } from "@/lib/api";
import { ADVISORY_NOTE, explainFactors, levelOf, standingOf, summarize, to100 } from "@/lib/risk";

// GET /api/students/:id/risk -> the student side panel (A2)
// status: "ok" | "no_audit" (student has no degree audit yet: empty state) | "not_computed" (job has not run)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return failCode("invalid_request", "Invalid student id", 400);
  try {
    const [s] = (await sql`
      SELECT s.id, s.display_name, s.is_synthetic, p.name AS program_name, p.total_credits,
             COALESCE(o.credits_earned, 0)::float8 AS credits_earned,
             COALESCE(o.credits_in_progress, 0)::float8 AS credits_in_progress,
             (SELECT COUNT(*) FROM completed_courses cc WHERE cc.student_id = s.id)::int AS audit_rows
      FROM students s
      LEFT JOIN programs p ON p.id = s.program_id
      LEFT JOIN student_overview o ON o.student_id = s.id
      WHERE s.id = ${studentId}`) as any[];
    if (!s) return failCode("student_not_found", "Student not found", 404);

    const [risk] = (await sql`
      SELECT risk_score::float8 AS risk_score, factors, model_version, computed_at
      FROM student_risk_latest WHERE student_id = ${studentId}`) as any[];

    const status = !s.audit_rows ? "no_audit" : !risk ? "not_computed" : "ok";
    const score = status === "ok" ? to100(risk.risk_score) : null;
    const factors = status === "ok" ? explainFactors(risk.factors) : [];

    return ok({
      status,
      student: {
        student_id: s.id,
        display_name: s.display_name,
        program_name: s.program_name,
        class_standing: standingOf(s.credits_earned),
        credits_earned: s.credits_earned,
        credits_in_progress: s.credits_in_progress,
        credits_remaining: Math.max(0, (s.total_credits ?? Number(process.env.DEGREE_CREDITS ?? 120)) - s.credits_earned),
      },
      risk_score: score,
      risk_level: levelOf(score),
      model_version: status === "ok" ? risk.model_version : null,
      computed_at: status === "ok" ? risk.computed_at : null,
      summary: status === "ok" ? summarize(factors) : null,
      factors,
      advisory_note: ADVISORY_NOTE,
      sample: !!s.is_synthetic,
    });
  } catch (e) {
    return serverError(e);
  }
}
