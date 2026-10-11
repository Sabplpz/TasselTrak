import { failCode, readJson, serverError, toId } from "@/lib/api";
import { studentMove, studentRemove } from "@/lib/student-board";

type Ctx = { params: Promise<{ id: string; courseId: string }> };

async function ids(ctx: Ctx) {
  const p = await ctx.params;
  return { studentId: toId(p.id), courseId: toId(p.courseId) };
}

// PATCH /api/students/:id/board/courses/:courseId { termCode, dryRun? }  (dragging a planned note to another semester)
//   dryRun:true while hovering -> 200 { dryRun, blocking, problems, blockingCourse, suggestedTerm, term, ... }
//   on drop (no dryRun) -> 200 board plan + { moved }, or 422 check_failed with the same payload.
export async function PATCH(req: Request, ctx: Ctx) {
  const { studentId, courseId } = await ids(ctx);
  if (!studentId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await studentMove(studentId, courseId, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/students/:id/board/courses/:courseId -> take a planned course off the board (undo with .../restore)
export async function DELETE(_req: Request, ctx: Ctx) {
  const { studentId, courseId } = await ids(ctx);
  if (!studentId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await studentRemove(studentId, courseId);
  } catch (e) {
    return serverError(e);
  }
}
