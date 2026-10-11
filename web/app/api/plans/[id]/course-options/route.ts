import { ok, failCode, serverError, toId } from "@/lib/api";
import { courseOptions } from "@/lib/plan";

// GET /api/plans/:id/course-options?term=spring-2027&search=
// The "Add course" picker: remaining requirements grouped by what they fill, each with whether its
// prerequisites are met in that term and what is missing.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  const u = new URL(req.url);
  try {
    const r = await courseOptions(planId, u.searchParams.get("term") || undefined, u.searchParams.get("search") || undefined);
    return r ? ok(r) : failCode("plan_not_found", "Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
