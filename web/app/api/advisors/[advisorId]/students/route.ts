import { sql } from "@/lib/db";
import { ok, failCode, serverError, toId } from "@/lib/api";
import { levelOf, standingOf, to100, HIGH_AT } from "@/lib/risk";

// GET /api/advisors/:advisorId/students?search=&major=&sort=risk_desc&limit=10&offset=0
// The advisor dashboard list (A1): one page of students plus the numbers in the header.
// sort: risk_desc (default) | risk_asc | name
export async function GET(req: Request, { params }: { params: Promise<{ advisorId: string }> }) {
  const advisorId = toId((await params).advisorId);
  if (!advisorId) return failCode("invalid_request", "Invalid advisor id", 400);
  const u = new URL(req.url);
  const search = u.searchParams.get("search")?.trim() || null;
  const major = u.searchParams.get("major")?.trim() || null;
  const sortParam = u.searchParams.get("sort") ?? "risk_desc";
  const sort = ["risk_desc", "risk_asc", "name"].includes(sortParam) ? sortParam : "risk_desc";
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 10) || 10, 1), 100);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);

  try {
    const [advisor] = (await sql`SELECT id, name, department FROM advisors WHERE id = ${advisorId}`) as any[];
    if (!advisor) return failCode("advisor_not_found", "Advisor not found", 404);

    const [rows, [{ n: filtered }], whole] = await Promise.all([
      sql`
        SELECT o.student_id, o.display_name, s.is_synthetic, p.name AS program_name, p.total_credits,
               o.credits_earned::float8 AS credits_earned, o.credits_in_progress::float8 AS credits_in_progress,
               o.open_flags::int AS open_flags, o.top_flag_severity, o.risk_score::float8 AS risk_raw,
               g.gpa::float8 AS gpa, gt.name AS projected_graduation, lp.id AS plan_id, lp.status AS plan_status
        FROM student_overview o
        JOIN students s ON s.id = o.student_id
        LEFT JOIN programs p ON p.id = o.program_id
        LEFT JOIN student_gpa g ON g.student_id = o.student_id
        LEFT JOIN terms gt ON gt.id = s.expected_graduation_term_id
        LEFT JOIN LATERAL (
          SELECT id, status FROM plans
          WHERE student_id = o.student_id AND status <> 'archived'
          ORDER BY created_at DESC, id DESC LIMIT 1
        ) lp ON TRUE
        WHERE o.advisor_id = ${advisorId}
          AND (${search}::text IS NULL OR o.display_name ILIKE '%' || ${search}::text || '%')
          AND (${major}::text IS NULL OR p.name = ${major}::text)
        ORDER BY CASE WHEN ${sort}::text = 'risk_desc' THEN o.risk_score END DESC NULLS LAST,
                 CASE WHEN ${sort}::text = 'risk_asc' THEN o.risk_score END ASC NULLS LAST,
                 o.display_name
        LIMIT ${limit} OFFSET ${offset}`,
      sql`
        SELECT COUNT(*)::int AS n FROM student_overview o
        LEFT JOIN programs p ON p.id = o.program_id
        WHERE o.advisor_id = ${advisorId}
          AND (${search}::text IS NULL OR o.display_name ILIKE '%' || ${search}::text || '%')
          AND (${major}::text IS NULL OR p.name = ${major}::text)`,
      sql`
        SELECT o.risk_score::float8 AS risk_raw, p.name AS program_name
        FROM student_overview o LEFT JOIN programs p ON p.id = o.program_id
        WHERE o.advisor_id = ${advisorId}`,
    ]);

    const all = whole as any[];
    const students = (rows as any[]).map((r) => {
      const score = to100(r.risk_raw);
      return {
        student_id: r.student_id,
        display_name: r.display_name,
        program_name: r.program_name,
        class_standing: standingOf(r.credits_earned),
        credits_earned: r.credits_earned,
        credits_in_progress: r.credits_in_progress,
        credits_remaining: Math.max(0, (r.total_credits ?? Number(process.env.DEGREE_CREDITS ?? 120)) - r.credits_earned),
        gpa: r.gpa,
        projected_graduation: r.projected_graduation,
        open_flags: r.open_flags,
        top_flag_severity: r.top_flag_severity,
        risk_score: score,
        risk_level: levelOf(score),
        plan_id: r.plan_id,
        plan_status: r.plan_status,
        sample: !!r.is_synthetic,
      };
    });

    return ok({
      advisor,
      summary: {
        total: all.length,
        high_risk: all.filter((r) => (to100(r.risk_raw) ?? -1) >= HIGH_AT).length,
      },
      majors: [...new Set(all.map((r) => r.program_name).filter(Boolean))].sort(),
      page: { limit, offset, total: filtered },
      students,
    });
  } catch (e) {
    return serverError(e);
  }
}
