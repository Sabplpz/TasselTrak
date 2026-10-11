import { failCode, ok, readJson, serverError, toId } from "@/lib/api";
import { loginStudent } from "@/lib/student-board";

// POST /api/students/login { studentId } -> { studentId, student, next: "upload" | "board" }
// Demo only: there is no password check. Real UCF sign-in is not built.
export async function POST(req: Request) {
  const studentId = toId(String((await readJson(req)).studentId ?? ""));
  if (!studentId) return failCode("invalid_request", "studentId is required", 400);
  try {
    return ok(await loginStudent(studentId));
  } catch (e) {
    return serverError(e);
  }
}
