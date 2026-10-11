import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId, readJson } from "@/lib/api";
import { assertEditable, getPlan } from "@/lib/plan";

// GET /api/plans/:id -> plan, terms, items (with section, reason, issues), totals, audit events
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid plan id", 400);
  try {
    const plan = await getPlan(id);
    return plan ? ok(plan) : failCode("plan_not_found", "Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/plans/:id { rationale?, name? } -> small metadata edits (refused once approved)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return failCode("invalid_request", "Invalid plan id", 400);
  const b = await readJson(req);
  try {
    await assertEditable(id);
    await sql`UPDATE plans SET
                rationale = COALESCE(${typeof b.rationale === "string" ? b.rationale : null}, rationale),
                name = COALESCE(${typeof b.name === "string" ? b.name : null}, name),
                updated_at = NOW()
              WHERE id = ${id}`;
    const plan = await getPlan(id);
    return plan ? ok(plan) : failCode("plan_not_found", "Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
