import { failCode, ok, serverError, toId } from "@/lib/api";
import { programCourses } from "@/lib/student-board";

// GET /api/programs/:id/courses -> { program, groups: [{ requirement, category, pickCount, courses[] }] }  (manual picker)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid program id", 400);
  try {
    return ok(await programCourses(id));
  } catch (e) {
    return serverError(e);
  }
}
