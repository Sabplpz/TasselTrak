import { failCode, serverError, toId, readJson } from "@/lib/api";
import { overrideItem } from "@/lib/plan-actions";

// POST /api/plans/:id/courses/:courseId/override { advisorId, note }
// The override modal (A6a): approve a course despite a blocking problem, with a written reason.
//   403 not_authorized | 400 note_required | 409 nothing_to_override
// The course then carries `override: { advisorName, at, note }` (the hover tag in A6b) and its
// problems stop counting toward `blocking`.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const planId = toId(p.id), courseId = toId(p.courseId);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await overrideItem(planId, courseId, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}
