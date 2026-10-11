import { failCode, serverError, toId, readJson } from "@/lib/api";
import { restoreCourse } from "@/lib/plan-actions";

// POST /api/plans/:id/courses/:courseId/restore { advisorId? }
// "Undo" after a remove: puts the course back in its term with its section, reason and flags.
// (Undo after an add is just DELETE.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const planId = toId(p.id), courseId = toId(p.courseId);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  const b = await readJson(req);
  try {
    return await restoreCourse(planId, courseId, toId(String(b.advisorId ?? "")));
  } catch (e) {
    return serverError(e);
  }
}
