import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { getPlan, logEvent } from "@/lib/plan";

// POST /api/plans/:id/reopen { advisorId? }  approved -> draft ("Reopen plan"); the board becomes editable again
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  const b = await readJson(req);
  try {
    const [p] = (await sql`SELECT status FROM plans WHERE id = ${planId}`) as any[];
    if (!p) return failCode("plan_not_found", "Plan not found", 404);
    if (p.status !== "approved") return failCode("invalid_status", "Only an approved plan can be reopened", 409, { status: p.status });
    await sql`UPDATE plans SET status = 'draft', approved_at = NULL, approved_by = NULL, submitted_at = NULL, updated_at = NOW()
              WHERE id = ${planId}`;
    await logEvent(planId, toId(String(b.advisorId ?? "")), "reopened", {});
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
