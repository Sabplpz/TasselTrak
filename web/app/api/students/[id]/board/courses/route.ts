import { failCode, readJson, serverError, toId } from "@/lib/api";
import { studentAdd } from "@/lib/student-board";

// POST /api/students/:id/board/courses { courseId, termCode?, dryRun? }  ("Add to Spring 2027", or dropping a note from the pool)
//   201 board plan + { added }   422 check_failed { problems, missing, blockingCourse, suggestedTerm, term }
//   409 read_only (approved) / in_review. dryRun:true only checks. Students cannot force an override.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid student id", 400);
  try {
    return await studentAdd(id, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}
