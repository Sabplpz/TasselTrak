import { failCode, serverError, toId, readJson } from "@/lib/api";
import { addCourse } from "@/lib/plan-actions";

// POST /api/plans/:id/items { courseId, reason?, advisorId?, dryRun?, force?, termCode? }
// Older route, kept. Same as POST /api/plans/:id/courses (term defaults to the next term).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  try {
    return await addCourse(planId, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}
