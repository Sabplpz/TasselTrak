import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// GET /api/students/:id -> everything the student detail screen needs
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const studentId = Number((await params).id);
  if (!Number.isInteger(studentId)) {
    return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
  }

  try {
    const [student] = await sql`
      SELECT * FROM student_overview WHERE student_id = ${studentId}`;
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const completed = await sql`
      SELECT c.code, c.title, c.credits, cc.grade, t.name AS term
      FROM completed_courses cc
      JOIN courses c ON c.id = cc.course_id
      LEFT JOIN terms t ON t.id = cc.term_id
      WHERE cc.student_id = ${studentId}
      ORDER BY t.year, t.season`;

    // Required program courses the student has not passed yet
    const remaining = await sql`
      SELECT c.id AS course_id, c.code, c.title, c.credits, pr.category,
             is_eligible(${studentId}, c.id) AS eligible
      FROM students s
      JOIN program_requirements pr ON pr.program_id = s.program_id
      JOIN courses c ON c.id = pr.course_id
      WHERE s.id = ${studentId}
        AND NOT EXISTS (
          SELECT 1 FROM completed_courses cc
          WHERE cc.student_id = s.id AND cc.course_id = c.id
            AND COALESCE(cc.grade, '') !~ '^(F|W)')
      ORDER BY pr.category, c.code`;

    const flags = await sql`
      SELECT id, flag_type, severity, message, created_at
      FROM student_flags
      WHERE student_id = ${studentId} AND status = 'open'
      ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

    const plans = await sql`
      SELECT id, name, status, rationale, model_name, approved_at
      FROM plans
      WHERE student_id = ${studentId}
      ORDER BY created_at DESC`;

    return NextResponse.json({ student, completed, remaining, flags, plans });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
