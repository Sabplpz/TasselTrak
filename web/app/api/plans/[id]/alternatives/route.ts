import { ok, failCode, serverError, toId } from "@/lib/api";
import { alternatives } from "@/lib/plan";

// GET /api/plans/:id/alternatives?itemId=&term=  -> courses the student can swap in (older route, kept)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid plan id", 400);
  const u = new URL(req.url);
  try {
    const list = await alternatives(id, toId(u.searchParams.get("itemId")) ?? undefined, u.searchParams.get("term") || undefined);
    return list ? ok({ alternatives: list }) : failCode("plan_not_found", "Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
