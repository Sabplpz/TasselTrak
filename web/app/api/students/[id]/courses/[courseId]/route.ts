import { failCode, ok, serverError, toId } from "@/lib/api";
import { courseDetail } from "@/lib/student-board";

// GET /api/students/:id/courses/:courseId?term=spring-2027 -> the course side panel (screens 3 and 8):
// status, prerequisites, what it unlocks (and what taking it would open up), professors, threads,
// and `addTo` (for the "Add to Spring 2027" button: allowed + the reason when not).
export async function GET(req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const studentId = toId(p.id), courseId = toId(p.courseId);
  if (!studentId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  const term = new URL(req.url).searchParams.get("term") || undefined;
  try {
    return ok(await courseDetail(studentId, courseId, term));
  } catch (e) {
    return serverError(e);
  }
}
