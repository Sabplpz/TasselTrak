import { sql } from "@/lib/db";
import { ok, fail, serverError, toId } from "@/lib/api";

// GET /api/students/:id -> everything the student detail screen needs
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return fail("Invalid student id");

  try {
    const [student] = (await sql`
      SELECT o.student_id, o.display_name, o.advisor_id, o.program_id,
             o.credits_earned::float8 AS credits_earned, o.credits_in_progress::float8 AS credits_in_progress,
             o.open_flags::int AS open_flags, o.top_flag_severity, o.risk_score::float8 AS risk_score, o.risk_level,
             s.external_id, s.target_credits, s.work_hours_per_week, s.preferences,
             s.is_synthetic, p.name AS program_name, a.name AS advisor_name,
             et.name AS entry_term, gt.name AS expected_graduation
      FROM student_overview o
      JOIN students s ON s.id = o.student_id
      LEFT JOIN programs p ON p.id = o.program_id
      LEFT JOIN advisors a ON a.id = o.advisor_id
      LEFT JOIN terms et ON et.id = s.entry_term_id
      LEFT JOIN terms gt ON gt.id = s.expected_graduation_term_id
      WHERE o.student_id = ${studentId}`) as any[];
    if (!student) return fail("Student not found", 404);

    const [completed, remaining, flags, plans, notes, risk] = await Promise.all([
      sql`SELECT c.code, c.title, c.credits::float8 AS credits, cc.grade, t.name AS term, (cc.grade IS NULL) AS in_progress
          FROM completed_courses cc
          JOIN courses c ON c.id = cc.course_id
          LEFT JOIN terms t ON t.id = cc.term_id
          WHERE cc.student_id = ${studentId}
          ORDER BY t.year, CASE t.season WHEN 'spring' THEN 1 WHEN 'summer' THEN 2 ELSE 3 END, c.code`,
      // requirements not yet passed or in progress
      sql`SELECT c.id AS course_id, c.code, c.title, c.credits::float8 AS credits, pr.category, pr.group_label,
                 pr.pick_count, pr.critical_path, COALESCE(d.depth, 1)::int AS depth,
                 is_eligible(${studentId}, c.id) AS eligible
          FROM students s
          JOIN program_requirements pr ON pr.program_id = s.program_id
          JOIN courses c ON c.id = pr.course_id
          LEFT JOIN program_course_depth d ON d.program_id = pr.program_id AND d.course_id = pr.course_id
          WHERE s.id = ${studentId}
            AND NOT EXISTS (SELECT 1 FROM completed_courses cc
                            WHERE cc.student_id = s.id AND cc.course_id = c.id
                              AND (cc.grade IS NULL OR grade_passes(cc.grade)))
          ORDER BY pr.critical_path DESC, COALESCE(d.depth, 1), c.code`,
      sql`SELECT f.id, f.flag_type, f.severity, f.message, f.created_at, c.code AS course_code
          FROM student_flags f LEFT JOIN courses c ON c.id = f.course_id
          WHERE f.student_id = ${studentId} AND f.status = 'open'
          ORDER BY CASE f.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.id`,
      sql`SELECT id, name, status, created_by, rationale, model_name, approved_at, created_at, updated_at
          FROM plans WHERE student_id = ${studentId} AND status <> 'archived'
          ORDER BY created_at DESC`,
      sql`SELECT n.id, n.body, n.created_at, a.name AS advisor_name
          FROM advisor_notes n JOIN advisors a ON a.id = n.advisor_id
          WHERE n.student_id = ${studentId} ORDER BY n.created_at DESC`,
      sql`SELECT risk_score::float8 AS risk_score, risk_level, factors, model_version, computed_at
          FROM student_risk_latest WHERE student_id = ${studentId}`,
    ]);

    return ok({ student, completed, remaining, flags, plans, notes, risk: (risk as any[])[0] ?? null });
  } catch (e) {
    return serverError(e);
  }
}
