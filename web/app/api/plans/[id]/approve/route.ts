import { sql } from "@/lib/db";
import { ok, fail, serverError, toId, readJson } from "@/lib/api";
import { getPlan, logEvent } from "@/lib/plan";

// POST /api/plans/:id/approve { advisorId, override?, note? }
// Re-validates first. Blocking issues return 409 unless override=true (recorded in the audit trail).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return fail("Invalid plan id");
  const b = await readJson(req);
  const advisorId = toId(String(b.advisorId ?? ""));
  if (!advisorId) return fail("advisorId is required");
  try {
    const current = await getPlan(planId);
    if (!current) return fail("Plan not found", 404);
    if (!current.items.length) return fail("Cannot approve an empty plan", 409);
    if (!current.canApprove && !b.override) {
      return fail("Plan has blocking issues", 409, {
        blocking: current.blocking,
        issues: [...current.items.flatMap((i) => i.issues), ...current.issues].filter((i) => i.severity === "high"),
      });
    }
    await sql`UPDATE plans SET status = 'approved', approved_by = ${advisorId}, approved_at = NOW(), updated_at = NOW()
              WHERE id = ${planId}`;
    // resolve open flags that this plan addresses is left to the advisor; we only record the approval
    await logEvent(planId, advisorId, "approved", {
      override: !current.canApprove,
      note: typeof b.note === "string" ? b.note : null,
      credits: current.totals.credits,
    });
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
