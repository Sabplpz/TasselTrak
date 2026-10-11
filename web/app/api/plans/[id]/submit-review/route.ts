import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { getPlan, logEvent } from "@/lib/plan";

// POST /api/plans/:id/submit-review { advisorId? }  draft -> in_review ("Sent for review Oct 8")
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  const b = await readJson(req);
  try {
    const [p] = (await sql`SELECT status FROM plans WHERE id = ${planId}`) as any[];
    if (!p) return failCode("plan_not_found", "Plan not found", 404);
    if (p.status !== "draft") return failCode("invalid_status", "Only a draft plan can be sent for review", 409, { status: p.status });
    const [{ n }] = (await sql`SELECT COUNT(*)::int AS n FROM plan_items WHERE plan_id = ${planId}`) as any[];
    if (!n) return failCode("empty_plan", "Cannot send an empty plan for review", 409);
    await sql`UPDATE plans SET status = 'in_review', submitted_at = NOW(), updated_at = NOW() WHERE id = ${planId}`;
    await logEvent(planId, toId(String(b.advisorId ?? "")), "submitted_for_review", {});
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
