import { failCode, serverError, toId, readJson } from "@/lib/api";
import { addCourse } from "@/lib/plan-actions";

// POST /api/plans/:id/courses { courseId, termCode?, reason?, advisorId?, dryRun?, force?, note? }
//   201 plan object + { added }          the course is on the board
//   422 check_failed { problems[], missing[], blockingCourse, suggestedTerm, term }
//                                        the in-place failure message; nothing was added
//   409 read_only                        the plan is approved
// termCode defaults to the next term. force:true records an override and needs an authorized advisor.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  try {
    return await addCourse(planId, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}
