import { ok, fail, serverError, toId, readJson } from "@/lib/api";
import { getPlan } from "@/lib/plan";
import { sql } from "@/lib/db";

// GET /api/plans/:id -> plan, items (with section, reason, issues), totals, audit events
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return fail("Invalid plan id");
  try {
    const plan = await getPlan(id);
    return plan ? ok(plan) : fail("Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/plans/:id { rationale?, name? } -> small metadata edits
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (!id) return fail("Invalid plan id");
  const b = await readJson(req);
  try {
    await sql`UPDATE plans SET
                rationale = COALESCE(${typeof b.rationale === "string" ? b.rationale : null}, rationale),
                name = COALESCE(${typeof b.name === "string" ? b.name : null}, name),
                updated_at = NOW()
              WHERE id = ${id}`;
    const plan = await getPlan(id);
    return plan ? ok(plan) : fail("Plan not found", 404);
  } catch (e) {
    return serverError(e);
  }
}
