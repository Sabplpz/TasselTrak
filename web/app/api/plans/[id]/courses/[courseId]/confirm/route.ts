import { failCode, serverError, toId, readJson } from "@/lib/api";
import { confirmItem } from "@/lib/plan-actions";

// POST /api/plans/:id/courses/:courseId/confirm { advisorId? } -> "Suggested" becomes confirmed
export async function POST(req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const planId = toId(p.id), courseId = toId(p.courseId);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  const b = await readJson(req);
  try {
    return await confirmItem(planId, courseId, toId(String(b.advisorId ?? "")));
  } catch (e) {
    return serverError(e);
  }
}
