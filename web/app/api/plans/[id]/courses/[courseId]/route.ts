import { failCode, serverError, toId, readJson } from "@/lib/api";
import { findItem, itemNotFound, moveItem, removeItem, swapItem } from "@/lib/plan-actions";

type Ctx = { params: Promise<{ id: string; courseId: string }> };

async function ids(ctx: Ctx) {
  const p = await ctx.params;
  return { planId: toId(p.id), courseId: toId(p.courseId) };
}

// PATCH /api/plans/:id/courses/:courseId { termCode, advisorId?, dryRun?, force? } -> move to another term
// 422 check_failed carries `suggestedTerm` ("Move to Spring 2027").
export async function PATCH(req: Request, ctx: Ctx) {
  const { planId, courseId } = await ids(ctx);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    const it = await findItem(planId, courseId);
    if (!it) return itemNotFound();
    return await moveItem(planId, it.id, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/plans/:id/courses/:courseId { newCourseId, reason?, advisorId?, dryRun?, force? } -> swap for another course
export async function PUT(req: Request, ctx: Ctx) {
  const { planId, courseId } = await ids(ctx);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    const it = await findItem(planId, courseId);
    if (!it) return itemNotFound();
    return await swapItem(planId, it.id, await readJson(req));
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/plans/:id/courses/:courseId?advisorId= -> remove. Undo with POST .../restore.
export async function DELETE(req: Request, ctx: Ctx) {
  const { planId, courseId } = await ids(ctx);
  if (!planId || !courseId) return failCode("invalid_request", "Invalid id", 400);
  try {
    const it = await findItem(planId, courseId);
    if (!it) return itemNotFound();
    return await removeItem(planId, it.id, toId(new URL(req.url).searchParams.get("advisorId")));
  } catch (e) {
    return serverError(e);
  }
}
