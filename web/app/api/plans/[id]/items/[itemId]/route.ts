import { failCode, serverError, toId, readJson } from "@/lib/api";
import { removeItem, swapItem } from "@/lib/plan-actions";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

// Older item-id routes, kept. New clients should use /api/plans/:id/courses/:courseId.

// PUT /api/plans/:id/items/:itemId { courseId, reason?, advisorId?, dryRun?, force? } -> swap
export async function PUT(req: Request, { params }: Ctx) {
  const p = await params;
  const planId = toId(p.id), itemId = toId(p.itemId);
  if (!planId || !itemId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await swapItem(planId, itemId, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/plans/:id/items/:itemId?advisorId=
export async function DELETE(req: Request, { params }: Ctx) {
  const p = await params;
  const planId = toId(p.id), itemId = toId(p.itemId);
  if (!planId || !itemId) return failCode("invalid_request", "Invalid id", 400);
  try {
    return await removeItem(planId, itemId, toId(new URL(req.url).searchParams.get("advisorId")));
  } catch (e) {
    return serverError(e);
  }
}
