import { sql } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { chat, extractJson } from "@/lib/llm";
import { termsAfter } from "@/lib/terms";
import {
  Cand, MAX_OVER_TARGET, Section, byPriority, candidatesFor, getStudent, getPlan, isSlot, loadCtx,
  pickSection, sectionsFor, termIdsWithSections,
} from "@/lib/plan";

// How many terms to fill after the next one (rule-based). 1 gives Spring 2027 + Fall 2027.
const EXTRA_TERMS = Number(process.env.PLAN_EXTRA_TERMS ?? 1);

// ---------------------------------------------------------------- next-term candidates (for the model)

type Candidate = {
  course_id: number;
  code: string;
  title: string;
  credits: number;
  category: string;
  group_label: string | null;
  pick_count: number | null;
  critical_path: boolean;
  depth: number;
  sections: Section[];
};

// Candidate courses from plan_candidates(), limited to courses with a section next term,
// plus how many slots each "pick N" group still needs.
async function loadCandidates(studentId: number, termId: number) {
  const rows = (await sql`SELECT * FROM plan_candidates(${studentId})`) as any[];
  const secs = await sectionsFor(rows.map((r) => r.course_id), termId);
  const cands: Candidate[] = rows
    .filter((r) => isSlot(r.code) || (secs[r.course_id] ?? []).length > 0)
    .map((r) => ({
      course_id: r.course_id,
      code: r.code,
      title: r.title,
      credits: Number(r.credits),
      category: r.category,
      group_label: r.group_label,
      pick_count: r.pick_count,
      critical_path: !!r.critical_path,
      depth: Number(r.depth),
      sections: secs[r.course_id] ?? [],
    }));

  const done = (await sql`
    SELECT pr.group_label, COUNT(DISTINCT pr.course_id)::int AS n
    FROM students s
    JOIN program_requirements pr ON pr.program_id = s.program_id AND pr.pick_count IS NOT NULL
    JOIN completed_courses cc ON cc.student_id = s.id AND cc.course_id = pr.course_id
     AND (cc.grade IS NULL OR grade_passes(cc.grade))
    WHERE s.id = ${studentId}
    GROUP BY pr.group_label`) as any[];
  const doneBy = Object.fromEntries(done.map((d) => [d.group_label, d.n]));
  const slotsLeft = (c: Candidate) =>
    c.pick_count == null ? Infinity : Math.max(0, c.pick_count - (doneBy[c.group_label ?? ""] ?? 0));
  return { cands, slotsLeft };
}

// Deterministic planner: critical path first, shallowest chain first, fill to target credits.
function rulePick(
  cands: Candidate[],
  slotsLeft: (c: Candidate) => number,
  target: number,
  prefs: any,
  already: { course: Candidate; section: Section | null }[] = []
) {
  const chosen = [...already];
  let credits = chosen.reduce((s, x) => s + x.course.credits, 0);
  const used: Record<string, number> = {};
  for (const x of chosen) if (x.course.group_label) used[x.course.group_label] = (used[x.course.group_label] ?? 0) + 1;
  const sorted = [...cands].sort(
    (a, b) => Number(b.critical_path) - Number(a.critical_path) || a.depth - b.depth || a.code.localeCompare(b.code)
  );
  for (const c of sorted) {
    if (credits >= target) break;
    if (chosen.some((x) => x.course.course_id === c.course_id)) continue;
    if (credits + c.credits > target + MAX_OVER_TARGET) continue;
    if (c.group_label && c.pick_count != null && (used[c.group_label] ?? 0) >= slotsLeft(c)) continue;
    const sec = pickSection(c.sections, chosen.map((x) => x.section).filter(Boolean) as Section[], prefs);
    if (!sec && !isSlot(c.code)) continue;
    chosen.push({ course: c, section: sec });
    credits += c.credits;
    if (c.group_label) used[c.group_label] = (used[c.group_label] ?? 0) + 1;
  }
  return chosen;
}

// ---------------------------------------------------------------- later terms (rules)

type Placed = { termId: number; termName: string; course: Cand; section: Section | null; reason: string };

// Fills the terms after the first one. A course is placed only in a term AFTER its prerequisites
// (the same rule the editor enforces), and only if it is offered in that season.
async function planLaterTerms(
  ctx: Awaited<ReturnType<typeof loadCtx>>,
  first: { courseId: number }[],
  extraTerms: number,
  target: number,
  prefs: any
): Promise<Placed[]> {
  const out: Placed[] = [];
  const placed = first.map((p) => ({ courseId: p.courseId, termKey: ctx.planTerm.key }));
  for (const t of termsAfter(ctx.terms, ctx.planTerm.key, extraTerms)) {
    const scheduled = (await termIdsWithSections([t.id])).has(t.id);
    const cands = (await candidatesFor(ctx, t, placed, scheduled))
      .filter((c) => !c.unmet.length && c.slotsLeft > 0)
      .filter((c) => !c.typically_offered?.length || c.typically_offered.includes(t.season))
      .filter((c) => !scheduled || isSlot(c.code) || c.sections.length > 0)
      .sort(byPriority);
    let credits = 0;
    const chosenSecs: Section[] = [];
    const used: Record<string, number> = {};
    for (const c of cands) {
      if (credits >= target) break;
      if (credits + c.credits > target + MAX_OVER_TARGET) continue;
      if (c.group_label && c.pick_count != null && (used[c.group_label] ?? 0) >= c.slotsLeft) continue;
      const sec = scheduled ? pickSection(c.sections, chosenSecs, prefs) : null;
      if (scheduled && !sec && !isSlot(c.code)) continue;
      if (sec) chosenSecs.push(sec);
      out.push({
        termId: t.id,
        termName: t.name,
        course: c,
        section: sec,
        reason: c.critical_path
          ? "Placed here once its prerequisites are done: a critical-path course for the degree."
          : `Placed here once its prerequisites are done: a ${c.category} requirement that keeps the student on pace.`,
      });
      placed.push({ courseId: c.course_id, termKey: t.key });
      credits += c.credits;
      if (c.group_label) used[c.group_label] = (used[c.group_label] ?? 0) + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- generation

const isTimeout = (m: string) => /abort|timed? ?out|timeout/i.test(m);

export async function generatePlan(
  studentId: number,
  advisorId?: number | null,
  opts: { allowFallback?: boolean; extraTerms?: number; signal?: AbortSignal } = {}
) {
  const allowFallback = opts.allowFallback ?? true;
  const extraTerms = opts.extraTerms ?? EXTRA_TERMS;

  const student = await getStudent(studentId);
  if (!student) throw new ApiError("student_not_found", "Student not found", 404);
  const ctx = await loadCtx(studentId);
  const term = ctx.planTerm;
  const target: number = student.target_credits;
  const prefs = student.preferences ?? {};

  const { cands, slotsLeft } = await loadCandidates(studentId, term.id);
  if (!cands.length) throw new ApiError("no_candidates", "No eligible courses with sections next term", 422);

  const [ov] = (await sql`SELECT credits_earned, credits_in_progress, risk_level FROM student_overview WHERE student_id = ${studentId}`) as any[];
  const flags = (await sql`SELECT flag_type, severity, message FROM student_flags WHERE student_id = ${studentId} AND status = 'open'`) as any[];
  const notes = (await sql`SELECT body FROM advisor_notes WHERE student_id = ${studentId} ORDER BY created_at DESC LIMIT 3`) as any[];

  // ---- ask the model
  let modelName = "unknown";
  let rationale = "";
  const picks: { course: Candidate; section: Section | null; reason: string }[] = [];
  let llmError: string | null = null;

  try {
    const lines = cands.map(
      (c) =>
        `${c.code} | ${c.title} | ${c.credits}cr | ${c.category}${c.group_label ? ` (pick ${c.pick_count} of "${c.group_label}", ${slotsLeft(c)} left)` : ""} | ${c.critical_path ? "CRITICAL PATH" : "not critical"} | chain depth ${c.depth} | ${isSlot(c.code) ? "requirement slot (advisor picks the specific class later)" : `open seats ${Math.max(...c.sections.map((s) => s.seats_open ?? 0))}`}`
    );
    const prompt = `You are drafting a next-semester course plan (${term.name}) for an academic advisor to review. All data is synthetic demo data.

STUDENT: ${student.display_name}, ${student.program_name}
Credits earned: ${ov?.credits_earned ?? 0}, in progress: ${ov?.credits_in_progress ?? 0}
Target load: ${target} credits (do not exceed ${target + MAX_OVER_TARGET}). Work hours/week: ${student.work_hours_per_week}.
Preferences: ${JSON.stringify(prefs)}
Open flags: ${flags.length ? flags.map((f) => `${f.flag_type}/${f.severity}: ${f.message}`).join("; ") : "none"}
Advisor notes: ${notes.length ? notes.map((n) => n.body).join(" | ") : "none"}

ELIGIBLE COURSES (choose ONLY from this list, using the exact code):
${lines.join("\n")}

Rules: prefer CRITICAL PATH courses and lower chain depth, then courses that unlock the most later courses. Respect "pick N" groups (never take more than the slots left). Stay near the target credits. Avoid stacking many hard courses for a student who works many hours or has a gpa_risk flag.
Reply with ONLY a JSON object, no prose outside it:
{"rationale":"2-3 sentences on the overall plan","courses":[{"code":"COP 3502C","reason":"one sentence specific to this student"}]}`;

    const { text: reply, model: usedModel } = await chat(
      [
        { role: "system", content: "You are a fast, precise academic-planning assistant. Do not deliberate at length: pick the courses and reply with the JSON immediately." },
        { role: "user", content: prompt },
      ],
      { maxTokens: 8000, timeoutMs: 30000, budgetMs: 48000 });
    modelName = usedModel;
    const parsed = extractJson<{ rationale?: string; courses?: { code: string; reason?: string }[] }>(reply);
    rationale = String(parsed.rationale ?? "").slice(0, 1200);

    const byCode = new Map(cands.map((c) => [c.code.replace(/\s+/g, " ").toUpperCase(), c]));
    const used: Record<string, number> = {};
    const chosenSecs: Section[] = [];
    let credits = 0;
    for (const item of parsed.courses ?? []) {
      const c = byCode.get(String(item.code ?? "").replace(/\s+/g, " ").trim().toUpperCase());
      if (!c || picks.some((p) => p.course.course_id === c.course_id)) continue;
      if (credits + c.credits > target + MAX_OVER_TARGET) continue;
      if (c.group_label && c.pick_count != null && (used[c.group_label] ?? 0) >= slotsLeft(c)) continue;
      const sec = pickSection(c.sections, chosenSecs, prefs);
      if (!sec && !isSlot(c.code)) continue; // the model proposed something that conflicts or is full: drop it
      if (sec) chosenSecs.push(sec);
      picks.push({ course: c, section: sec, reason: String(item.reason ?? "").slice(0, 400) || "Recommended by the planner." });
      credits += c.credits;
      if (c.group_label) used[c.group_label] = (used[c.group_label] ?? 0) + 1;
    }
  } catch (e) {
    llmError = e instanceof Error ? e.message : String(e);
  }

  // The editor's "failed" state promises nothing changed: refuse instead of saving a rules draft.
  if (llmError && !allowFallback)
    throw new ApiError(
      isTimeout(llmError) ? "planner_timeout" : "planner_failed",
      isTimeout(llmError) ? "The planner timed out before it finished. Nothing on the board changed." : "The planner could not build a draft. Nothing on the board changed.",
      504,
      { detail: llmError.slice(0, 300) }
    );

  // ---- top up with rules if the model fell short (or failed entirely)
  const have = picks.reduce((s, p) => s + p.course.credits, 0);
  if (have < target - 2) {
    const filled = rulePick(cands, slotsLeft, target, prefs, picks.map((p) => ({ course: p.course, section: p.section })));
    for (const f of filled) {
      if (picks.some((p) => p.course.course_id === f.course.course_id)) continue;
      picks.push({
        course: f.course,
        section: f.section,
        reason: f.course.critical_path
          ? "Added by rule: critical-path course for your degree that you are eligible for."
          : `Added by rule: eligible ${f.course.category} requirement that keeps you on pace.`,
      });
    }
    if (llmError) {
      modelName = "rules-fallback";
      rationale = `The AI model was unavailable (${llmError.slice(0, 120)}), so this draft uses the rule-based planner: critical-path courses first, then the shortest prerequisite chains, within ${target} credits.`;
    } else if (!rationale) {
      rationale = "Draft built by the planner.";
    }
  }
  if (!picks.length) throw new ApiError("no_candidates", "Could not build a plan from the eligible courses", 422);

  // ---- later terms (rules), so the board shows more than one semester
  const later = extraTerms > 0 ? await planLaterTerms(ctx, picks.map((p) => ({ courseId: p.course.course_id })), extraTerms, target, prefs) : [];
  if (later.length) {
    const byTerm = new Map<string, string[]>();
    for (const l of later) byTerm.set(l.termName, [...(byTerm.get(l.termName) ?? []), l.course.code]);
    const extra = [...byTerm].map(([name, codes]) => `${name} (${codes.join(", ")}) is filled by rules once the prerequisites are done.`).join(" ");
    rationale = `${rationale} ${extra}`.trim();
  }

  // Cancel: the advisor aborted the request, so save nothing.
  if (opts.signal?.aborted) throw new ApiError("cancelled", "Plan generation was cancelled. Nothing was changed.", 499);

  // ---- save: the new draft goes in first, older drafts are archived after, so the student
  // is never left without a plan if something fails half way.
  const [plan] = (await sql`
    INSERT INTO plans (student_id, name, status, created_by, model_name, rationale)
    VALUES (${studentId}, ${`${term.name} plan`}, 'draft', 'ai', ${modelName}, ${rationale})
    RETURNING id`) as any[];
  try {
    const rows = [
      ...picks.map((p) => ({ termId: term.id, courseId: p.course.course_id, sectionId: p.section?.id ?? null, reason: p.reason })),
      ...later.map((l) => ({ termId: l.termId, courseId: l.course.course_id, sectionId: l.section?.id ?? null, reason: l.reason })),
    ];
    await sql`
      INSERT INTO plan_items (plan_id, term_id, course_id, section_id, reason, source, confirmed)
      SELECT ${plan.id}, x.term_id, x.course_id, x.section_id, x.reason, 'ai', FALSE
      FROM unnest(${rows.map((r) => r.termId)}::int[], ${rows.map((r) => r.courseId)}::int[],
                  ${rows.map((r) => r.sectionId)}::int[], ${rows.map((r) => r.reason)}::text[])
           AS x(term_id, course_id, section_id, reason)`;
    await sql`UPDATE plans SET status = 'archived', updated_at = NOW()
              WHERE student_id = ${studentId} AND status IN ('draft', 'in_review') AND id <> ${plan.id}`;
    await sql`INSERT INTO plan_events (plan_id, actor_type, advisor_id, action, detail)
              VALUES (${plan.id}, 'ai', ${advisorId ?? null}, 'generated',
                      ${JSON.stringify({ model: modelName, courses: picks.map((p) => p.course.code), later: later.map((l) => `${l.termName}: ${l.course.code}`), llm_error: llmError })}::jsonb)`;
  } catch (e) {
    await sql`DELETE FROM plans WHERE id = ${plan.id}`;
    throw e;
  }
  return getPlan(plan.id);
}
