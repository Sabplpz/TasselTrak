import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";

// POST /api/students/:id/remind  { advisorId }
// "Send a reminder" on the empty student panel (student has not uploaded a degree audit).
// There is no email or notification service in the demo, so this records the reminder as an advisor
// note and says so: { recorded: true, delivered: false }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return failCode("invalid_request", "Invalid student id", 400);
  const b = await readJson(req);
  const advisorId = toId(String(b.advisorId ?? ""));
  if (!advisorId) return failCode("advisor_required", "advisorId is required", 400);
  try {
    const [s] = (await sql`SELECT id, display_name FROM students WHERE id = ${studentId}`) as any[];
    if (!s) return failCode("student_not_found", "Student not found", 404);
    const [a] = (await sql`SELECT id FROM advisors WHERE id = ${advisorId}`) as any[];
    if (!a) return failCode("advisor_not_found", "Advisor not found", 404);
    const [note] = (await sql`
      INSERT INTO advisor_notes (student_id, advisor_id, body)
      VALUES (${studentId}, ${advisorId}, 'Reminder: please upload your degree audit so your board can be built.')
      RETURNING id, created_at`) as any[];
    return ok({ recorded: true, delivered: false, noteId: note.id, at: note.created_at }, 201);
  } catch (e) {
    return serverError(e);
  }
}
