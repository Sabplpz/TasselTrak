import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { generatePlan } from "@/lib/planner";

export const maxDuration = 60;

// POST /api/students/:id/plan/generate  { advisorId?, replace?, allowFallback? }
//
//   409 { code: "plan_exists", planId, status }   a draft or in-review plan exists and replace is not true
//                                                 (drives the "Open existing plan / Generate a new draft" dialog)
//   409 { code: "plan_approved", planId }         approved plans must be reopened first
//   504 { code: "planner_timeout" | "planner_failed" }
//                                                 the model failed; NOTHING was changed (the "failed" banner)
//   201 plan object                               the new draft (older drafts archived)
//
// The call is one request of up to ~50 s. Cancel = abort the fetch: the server checks the abort
// signal just before saving, so a cancelled request saves nothing.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return failCode("invalid_request", "Invalid student id", 400);
  const body = await readJson(req);
  try {
    const [s] = (await sql`SELECT id FROM students WHERE id = ${studentId}`) as any[];
    if (!s) return failCode("student_not_found", "Student not found", 404);

    const [live] = (await sql`
      SELECT id, status FROM plans WHERE student_id = ${studentId} AND status <> 'archived'
      ORDER BY created_at DESC, id DESC LIMIT 1`) as any[];
    if (live?.status === "approved")
      return failCode("plan_approved", "This plan is approved. Reopen it before generating a new draft.", 409, { planId: live.id });
    if (live && !body.replace)
      return failCode("plan_exists", "This student already has a plan", 409, { planId: live.id, status: live.status });

    const plan = await generatePlan(studentId, toId(String(body.advisorId ?? "")), { allowFallback: !!body.allowFallback, signal: req.signal });
    return ok(plan, 201);
  } catch (e) {
    return serverError(e);
  }
}
