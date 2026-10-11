import { ok, failCode, serverError, toId } from "@/lib/api";
import { dependents } from "@/lib/plan";

// GET /api/plans/:id/courses/:courseId/dependents
// The remove confirmation (what else is affected): courses on this board that stop being valid if this
// one leaves. `direct: true` = needed it themselves; false = only broken because a direct one broke.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const planId = toId(p.id), courseId = toId(p.courseId);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    const r = await dependents(planId, courseId);
    if (!r) return failCode("plan_not_found", "Plan not found", 404);
    if (!r.course) return failCode("item_not_found", "That course is not in this plan", 404);
    return ok(r);
  } catch (e) {
    return serverError(e);
  }
}
