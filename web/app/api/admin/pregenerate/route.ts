import { sql } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api";
import { generatePlan } from "@/lib/plan";

export const maxDuration = 60;

// POST /api/admin/pregenerate?secret=...&limit=2
// Generates drafts for students that have no live plan yet. Call repeatedly (small limit)
// to stay inside the function time limit. Use before the demo so the first load is instant.
export async function POST(req: Request) {
  const u = new URL(req.url);
  if (!process.env.ADMIN_SECRET || u.searchParams.get("secret") !== process.env.ADMIN_SECRET)
    return fail("Forbidden", 403);
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 2) || 2, 5);
  try {
    const todo = (await sql`
      SELECT s.id, s.display_name FROM students s
      WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.student_id = s.id AND p.status <> 'archived')
      ORDER BY s.id LIMIT ${limit}`) as any[];
    const done: { student: string; plan?: number; model?: string | null; error?: string }[] = [];
    for (const s of todo) {
      try {
        const r = await generatePlan(s.id, null);
        done.push({ student: s.display_name, plan: r!.plan.id, model: r!.plan.modelName });
      } catch (e) {
        done.push({ student: s.display_name, error: (e as Error).message });
      }
    }
    const [left] = (await sql`
      SELECT COUNT(*)::int AS n FROM students s
      WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.student_id = s.id AND p.status <> 'archived')`) as any[];
    return ok({ generated: done, remaining: left.n });
  } catch (e) {
    return serverError(e);
  }
}
