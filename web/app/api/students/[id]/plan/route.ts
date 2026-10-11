import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { getPlan } from "@/lib/plan";
import { generatePlan } from "@/lib/planner";

export const maxDuration = 60;

// GET /api/students/:id/plan -> the student's current plan (draft, in review or approved).
// 404 { code: "no_plan" } is the "Nora doesn't have a plan yet" state.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return failCode("invalid_request", "Invalid student id", 400);
  try {
    const [s] = (await sql`SELECT id FROM students WHERE id = ${studentId}`) as any[];
    if (!s) return failCode("student_not_found", "Student not found", 404);
    const [p] = (await sql`
      SELECT id FROM plans WHERE student_id = ${studentId} AND status <> 'archived'
      ORDER BY created_at DESC, id DESC LIMIT 1`) as any[];
    if (!p) return failCode("no_plan", "This student does not have a plan yet", 404);
    return ok(await getPlan(p.id));
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/students/:id/plan  { advisorId? }   (older route, kept)
// Always writes a fresh draft and archives older drafts; falls back to rules if the model fails.
// New clients should use POST /api/students/:id/plan/generate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return failCode("invalid_request", "Invalid student id", 400);
  const body = await readJson(req);
  try {
    const result = await generatePlan(studentId, toId(String(body.advisorId ?? "")), { allowFallback: true });
    return ok(result, 201);
  } catch (e) {
    return serverError(e);
  }
}
