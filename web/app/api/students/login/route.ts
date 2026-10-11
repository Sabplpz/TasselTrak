import { failCode, ok, readJson, serverError, toId } from "@/lib/api";
import { loginStudent } from "@/lib/student-board";

// POST /api/students/login { studentId } or { email } -> { studentId, student, next: "upload" | "board" }
// `email` is the signed-in account's email, matched to students.email.
// Demo only: there is no password check. Real UCF sign-in is not built.
export async function POST(req: Request) {
  const body = await readJson(req);
  const studentId = toId(String(body.studentId ?? ""));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!studentId && !email) return failCode("invalid_request", "studentId or email is required", 400);
  try {
    return ok(await loginStudent(studentId ? { studentId } : { email }));
  } catch (e) {
    return serverError(e);
  }
}
