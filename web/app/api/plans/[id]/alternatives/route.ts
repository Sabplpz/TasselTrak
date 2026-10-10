import { ok, fail, serverError, toId } from "@/lib/api";
import { alternatives } from "@/lib/plan";

// GET /api/plans/:id/alternatives?itemId=  -> courses the student can swap in
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return fail("Invalid plan id");
  try {
    const list = await alternatives(id, toId(new URL(req.url).searchParams.get("itemId")) ?? undefined);
    return list ? ok({ alternatives: list }) : fail("Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
