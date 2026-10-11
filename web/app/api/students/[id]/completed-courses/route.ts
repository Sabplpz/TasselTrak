import { failCode, ok, readJson, serverError, toId } from "@/lib/api";
import { readHistory, saveHistory } from "@/lib/student-board";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/students/:id/completed-courses -> { programId, courses: [{ courseId, code, title, credits, grade, status, termCode }] }
export async function GET(_req: Request, { params }: Ctx) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid student id", 400);
  try {
    return ok(await readHistory(id));
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/students/:id/completed-courses { programId?, mode?: "replace"|"merge", courses: [{ courseId, grade?, status?, termCode? }] }
// Screen 5 "Build my board" and screen 4 "Looks good, build my board" both save here.
export async function PUT(req: Request, { params }: Ctx) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid student id", 400);
  try {
    return ok(await saveHistory(id, await readJson(req)));
  } catch (e) {
    return serverError(e);
  }
}
