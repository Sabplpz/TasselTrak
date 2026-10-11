import { failCode, ok, serverError, toId } from "@/lib/api";
import { getBoard } from "@/lib/student-board";

// GET /api/students/:id/board -> the canvas (screen 2): header numbers, term columns, every course as a note, prerequisite edges.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid student id", 400);
  try {
    return ok(await getBoard(id));
  } catch (e) {
    return serverError(e);
  }
}
