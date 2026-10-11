import { ok, failCode, serverError, toId } from "@/lib/api";
import { alternatives } from "@/lib/plan";
import { findItem, itemNotFound } from "@/lib/plan-actions";

// GET /api/plans/:id/courses/:courseId/alternatives -> courses that could take this course's place
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const planId = toId(p.id), courseId = toId(p.courseId);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    const it = await findItem(planId, courseId);
    if (!it) return itemNotFound();
    const list = await alternatives(planId, it.id);
    return list ? ok({ alternatives: list }) : failCode("plan_not_found", "Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
