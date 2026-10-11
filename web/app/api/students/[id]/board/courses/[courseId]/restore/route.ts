import { failCode, serverError, toId } from "@/lib/api";
import { studentRestore } from "@/lib/student-board";

// POST /api/students/:id/board/courses/:courseId/restore -> undo the last remove of that course
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const p = await params;
  const studentId = toId(p.id), courseId = toId(p.courseId);
  if (!studentId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await studentRestore(studentId, courseId);
  } catch (e) {
    return serverError(e);
  }
}
