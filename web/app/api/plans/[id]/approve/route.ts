import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { getAdvisor, getPlan, logEvent } from "@/lib/plan";

// POST /api/plans/:id/approve { advisorId, override?, note? }
// Re-validates first.
//   409 blocking_issues  { blocking, issues[] }  problems remain (A5). Fix them, or override each one
//                                                with POST /courses/:courseId/override.
//   403 not_authorized                           override requested by an advisor who may not
//   400 note_required                            override requested without a written reason
//   409 already_approved | empty_plan
// `override: true` + `note` is a shortcut that overrides every remaining blocking course at once.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const planId = toId((await params).id);
  if (!planId) return failCode("invalid_request", "Invalid plan id", 400);
  const b = await readJson(req);
  const advisorId = toId(String(b.advisorId ?? ""));
  if (!advisorId) return failCode("advisor_required", "advisorId is required", 400);
  try {
    const current = await getPlan(planId);
    if (!current) return failCode("plan_not_found", "Plan not found", 404);
    if (current.plan.status === "approved") return failCode("already_approved", "This plan is already approved", 409);
    if (current.plan.status === "archived") return failCode("archived", "This plan was replaced by a newer draft", 409);
    if (!current.items.length) return failCode("empty_plan", "Cannot approve an empty plan", 409);

    let overrides = current.totals.overrides;
    if (!current.canApprove) {
      if (!b.override)
        return failCode("blocking_issues", "Plan has blocking issues", 409, { blocking: current.blocking, issues: current.blockingIssues });
      const advisor = await getAdvisor(advisorId);
      if (!advisor?.can_override) return failCode("not_authorized", "This advisor is not authorized to override problems", 403);
      const note = typeof b.note === "string" ? b.note.trim() : "";
      if (!note) return failCode("note_required", "A written reason is required to override problems", 400);
      const codes = new Set(current.blockingIssues.map((i) => i.courseId).filter(Boolean) as number[]);
      for (const it of current.items.filter((i) => codes.has(i.courseId) && !i.override)) {
        await sql`UPDATE plan_items SET override_by = ${advisorId}, override_note = ${note}, override_at = NOW() WHERE id = ${it.id}`;
        await logEvent(planId, advisorId, "override", { code: it.code, courseId: it.courseId, termCode: it.termCode, note });
        overrides += 1;
      }
    }

    // Signing off the plan confirms every course still marked Suggested.
    await sql`UPDATE plan_items SET confirmed = TRUE WHERE plan_id = ${planId} AND confirmed = FALSE`;
    await sql`UPDATE plans SET status = 'approved', approved_by = ${advisorId}, approved_at = NOW(), updated_at = NOW()
              WHERE id = ${planId}`;
    await logEvent(planId, advisorId, "approved", {
      overrides,
      note: typeof b.note === "string" ? b.note : null,
      credits: current.totals.credits,
      terms: current.totals.terms,
    });
    return ok(await getPlan(planId));
  } catch (e) {
    return serverError(e);
  }
}
