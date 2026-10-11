import { ok, serverError } from "@/lib/api";
import { listStudents } from "@/lib/student-board";

// GET /api/students?search=&limit=20&offset=0 -> the demo "pick a student" login list (no real auth)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const search = u.searchParams.get("search")?.trim() || null;
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  try {
    return ok(await listStudents(search, limit, offset));
  } catch (e) {
    return serverError(e);
  }
}
