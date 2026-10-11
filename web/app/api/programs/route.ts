import { ok, serverError } from "@/lib/api";
import { listPrograms } from "@/lib/student-board";

// GET /api/programs -> { programs: [{ id, name, degreeType, catalogYear, totalCredits, courses }] }  (the major picker)
export async function GET() {
  try {
    return ok({ programs: await listPrograms() });
  } catch (e) {
    return serverError(e);
  }
}
