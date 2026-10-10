import { ok, fail, serverError, toId, readJson } from "@/lib/api";
import { generatePlan } from "@/lib/plan";

export const maxDuration = 60;

// POST /api/students/:id/plan  { advisorId? } -> generates a fresh AI draft (older drafts are archived)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const studentId = toId((await params).id);
  if (!studentId) return fail("Invalid student id");
  const body = await readJson(req);
  try {
    const result = await generatePlan(studentId, toId(String(body.advisorId ?? "")));
    return ok(result, 201);
  } catch (e) {
    return serverError(e);
  }
}
