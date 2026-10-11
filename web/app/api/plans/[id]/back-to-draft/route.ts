import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { getPlan, logEvent } from "@/lib/plan";

// POST /api/plans/:id/back-to-draft { advisorId? }  in_review -> draft ("Back to draft")
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  const b = await readJson(req);
  try {
    const [p] = (await sql`SELECT status FROM plans WHERE id = ${planId}`) as any[];
    if (!p) return failCode("plan_not_found", "Plan not found", 404);
    if (p.status !== "in_review") return failCode("invalid_status", "Only a plan in review can go back to draft", 409, { status: p.status });
    await sql`UPDATE plans SET status = 'draft', submitted_at = NULL, updated_at = NOW() WHERE id = ${planId}`;
    await logEvent(planId, toId(String(b.advisorId ?? "")), "back_to_draft", {});
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
