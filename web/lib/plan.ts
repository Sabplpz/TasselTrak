import { sql } from "@/lib/db";
import { chat, extractJson } from "@/lib/llm";

export const PLAN_TERM = process.env.PLAN_TERM || "spring-2027";
const SEAT_RISK_AT = 6; // same threshold the seeded seat_risk flags use
const MAX_OVER_TARGET = 3;

// "GEP HUM1", "ELEC TECH3"... are requirement slots, not real classes: they have no sections.
export const isSlot = (code: string) => /^(GEP|ELEC) /.test(code);

export type Issue = {
  type:
    | "not_eligible"
    | "already_completed"
    | "no_section"
    | "seat_full"
    | "seat_risk"
    | "time_conflict"
    | "credits_over"
    | "credits_under"
    | "not_in_program";
  severity: "high" | "medium" | "low";
  message: string;
  courseId?: number;
  code?: string;
};

type Section = {
  id: number;
  crn: string | null;
  section_code: string | null;
  modality: string | null;
  days: string[];
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  enrolled: number | null;
  seats_open: number | null;
  instructor: string | null;
};

// ---------------------------------------------------------------- helpers

export async function getTerm(code = PLAN_TERM) {
  const [t] = await sql`SELECT id, code, name FROM terms WHERE code = ${code} LIMIT 1`;
  if (!t) throw new Error(`Term '${code}' not found`);
  return t as { id: number; code: string; name: string };
}

async function getStudent(studentId: number) {
  const [s] = await sql`
    SELECT s.id, s.display_name, s.advisor_id, s.program_id, s.target_credits,
           s.work_hours_per_week, s.preferences, p.name AS program_name
    FROM students s LEFT JOIN programs p ON p.id = s.program_id
    WHERE s.id = ${studentId}`;
  return s as any | undefined;
}

async function sectionsFor(courseIds: number[], termId: number): Promise<Record<number, Section[]>> {
  if (!courseIds.length) return {};
  const rows = await sql`
    SELECT s.id, s.course_id, s.crn, s.section_code, s.modality, s.days,
           s.start_time::text AS start_time, s.end_time::text AS end_time,
           s.capacity, s.enrolled, s.seats_open, i.name AS instructor
    FROM sections s LEFT JOIN instructors i ON i.id = s.instructor_id
    WHERE s.term_id = ${termId} AND s.course_id = ANY(${courseIds}::int[])
    ORDER BY s.course_id, s.section_code`;
  const out: Record<number, Section[]> = {};
  for (const r of rows as any[]) (out[r.course_id] ||= []).push(r as Section);
  return out;
}

function overlaps(a: Section, b: Section): boolean {
  if (!a.days?.length || !b.days?.length) return false; // online / async
  if (!a.start_time || !b.start_time || !a.end_time || !b.end_time) return false;
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

function conflicts(sec: Section, chosen: Section[]) {
  return chosen.some((c) => overlaps(sec, c));
}

// Best section for a course given what is already chosen: no conflicts, seats open,
// respects "avoid_mornings", most open seats first.
function pickSection(secs: Section[] = [], chosen: Section[], prefs: any): Section | null {
  const avoidMornings = !!prefs?.avoid_mornings;
  const usable = secs.filter((s) => (s.seats_open ?? 0) > 0 && !conflicts(s, chosen));
  const score = (s: Section) =>
    (avoidMornings && s.start_time && s.start_time < "10:00:00" ? 1000 : 0) - (s.seats_open ?? 0);
  return usable.sort((a, b) => score(a) - score(b))[0] ?? null;
}

// Which prerequisite groups does this student still miss for this course?
export async function missingPrereqs(studentId: number, courseId: number): Promise<string[][]> {
  const rows = await sql`
    WITH s AS (SELECT program_id FROM students WHERE id = ${studentId})
    SELECT p.group_no, array_agg(rc.code ORDER BY rc.code) AS codes
    FROM prerequisites p
    JOIN s ON TRUE
    JOIN courses rc ON rc.id = p.required_course_id
    WHERE p.course_id = ${courseId} AND p.kind = 'prereq'
      AND (p.program_id IS NULL OR p.program_id = s.program_id)
      AND NOT EXISTS (
        SELECT 1 FROM prerequisites p2
        JOIN completed_courses cc
          ON cc.student_id = ${studentId} AND cc.course_id = p2.required_course_id
         AND (cc.grade IS NULL OR grade_passes(cc.grade))
        WHERE p2.course_id = p.course_id AND p2.kind = 'prereq' AND p2.group_no = p.group_no
          AND (p2.program_id IS NULL OR p2.program_id = s.program_id))
    GROUP BY p.group_no ORDER BY p.group_no`;
  return (rows as any[]).map((r) => r.codes as string[]);
}

const fmtGroup = (g: string[]) => (g.length > 1 ? `one of ${g.join(" / ")}` : g[0]);

// ---------------------------------------------------------------- candidates

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

// ---------------------------------------------------------------- generation

export async function generatePlan(studentId: number, advisorId?: number | null) {
  const student = await getStudent(studentId);
  if (!student) throw new Error("Student not found");
  const term = await getTerm();
  const target: number = student.target_credits;
  const prefs = student.preferences ?? {};

  const { cands, slotsLeft } = await loadCandidates(studentId, term.id);
  if (!cands.length) throw new Error("No eligible courses with sections next term");

  const [ov] = (await sql`SELECT credits_earned, credits_in_progress, risk_level FROM student_overview WHERE student_id = ${studentId}`) as any[];
  const flags = (await sql`SELECT flag_type, severity, message FROM student_flags WHERE student_id = ${studentId} AND status = 'open'`) as any[];
  const notes = (await sql`SELECT body FROM advisor_notes WHERE student_id = ${studentId} ORDER BY created_at DESC LIMIT 3`) as any[];

  // ---- ask the model
  let modelName = "unknown";
  let rationale = "";
  let picks: { course: Candidate; section: Section | null; reason: string; source: "ai" }[] = [];
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
      picks.push({ course: c, section: sec, reason: String(item.reason ?? "").slice(0, 400) || "Recommended by the planner.", source: "ai" });
      credits += c.credits;
      if (c.group_label) used[c.group_label] = (used[c.group_label] ?? 0) + 1;
    }
  } catch (e) {
    llmError = e instanceof Error ? e.message : String(e);
  }

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
        source: "ai",
      });
    }
    if (llmError) {
      modelName = "rules-fallback";
      rationale = `The AI model was unavailable (${llmError.slice(0, 120)}), so this draft uses the rule-based planner: critical-path courses first, then the shortest prerequisite chains, within ${target} credits.`;
    } else if (!rationale) {
      rationale = "Draft built by the planner.";
    }
  }
  if (!picks.length) throw new Error("Could not build a plan from the eligible courses");

  // ---- save (archive older drafts so the UI always has one live plan)
  await sql`UPDATE plans SET status = 'archived', updated_at = NOW()
            WHERE student_id = ${studentId} AND status IN ('draft', 'in_review')`;
  const [plan] = (await sql`
    INSERT INTO plans (student_id, name, status, created_by, model_name, rationale)
    VALUES (${studentId}, ${`${term.name} plan`}, 'draft', 'ai', ${modelName}, ${rationale})
    RETURNING id`) as any[];
  for (const p of picks) {
    await sql`INSERT INTO plan_items (plan_id, term_id, course_id, section_id, reason, source)
              VALUES (${plan.id}, ${term.id}, ${p.course.course_id}, ${p.section?.id ?? null}, ${p.reason}, 'ai')`;
  }
  await sql`INSERT INTO plan_events (plan_id, actor_type, advisor_id, action, detail)
            VALUES (${plan.id}, 'ai', ${advisorId ?? null}, 'generated',
                    ${JSON.stringify({ model: modelName, courses: picks.map((p) => p.course.code), llm_error: llmError })}::jsonb)`;
  return getPlan(plan.id);
}

// ---------------------------------------------------------------- reading + validating a plan

export async function getPlan(planId: number) {
  const [plan] = (await sql`
    SELECT p.*, a.name AS approved_by_name
    FROM plans p LEFT JOIN advisors a ON a.id = p.approved_by
    WHERE p.id = ${planId}`) as any[];
  if (!plan) return null;
  const student = await getStudent(plan.student_id);

  const items = (await sql`
    SELECT pi.id, pi.term_id, pi.course_id, pi.section_id, pi.reason, pi.source,
           c.code, c.title, c.credits
    FROM plan_items pi JOIN courses c ON c.id = pi.course_id
    WHERE pi.plan_id = ${planId} ORDER BY c.code`) as any[];

  const sectionIds = items.map((i) => i.section_id).filter(Boolean);
  const secRows = sectionIds.length
    ? ((await sql`
        SELECT s.id, s.crn, s.section_code, s.modality, s.days,
               s.start_time::text AS start_time, s.end_time::text AS end_time,
               s.capacity, s.enrolled, s.seats_open, i.name AS instructor
        FROM sections s LEFT JOIN instructors i ON i.id = s.instructor_id
        WHERE s.id = ANY(${sectionIds}::int[])`) as any[])
    : [];
  const secById = new Map<number, Section>(secRows.map((s) => [s.id, s as Section]));

  const [term] = items.length
    ? ((await sql`SELECT code, name FROM terms WHERE id = ${items[0].term_id}`) as any[])
    : [await getTerm()];

  // course ids this student cannot be in at all
  const reqIds = new Set(
    ((await sql`SELECT course_id FROM program_requirements WHERE program_id = ${student.program_id}`) as any[]).map((r) => r.course_id)
  );

  const outItems = await Promise.all(
    items.map(async (it) => {
      const sec = it.section_id ? secById.get(it.section_id) ?? null : null;
      const issues: Issue[] = [];
      const base = { courseId: it.course_id, code: it.code };

      const [passed] = (await sql`
        SELECT 1 FROM completed_courses WHERE student_id = ${plan.student_id} AND course_id = ${it.course_id}
          AND grade IS NOT NULL AND grade_passes(grade) LIMIT 1`) as any[];
      if (passed) issues.push({ ...base, type: "already_completed", severity: "high", message: `${it.code} is already completed.` });

      const missing = await missingPrereqs(plan.student_id, it.course_id);
      if (missing.length)
        issues.push({ ...base, type: "not_eligible", severity: "high", message: `${it.code} needs ${missing.map(fmtGroup).join(" and ")} first.` });

      if (!reqIds.has(it.course_id))
        issues.push({ ...base, type: "not_in_program", severity: "low", message: `${it.code} is not a listed requirement for this program.` });

      if (isSlot(it.code)) {
        // requirement slot: no section expected
      } else if (!sec) issues.push({ ...base, type: "no_section", severity: "high", message: `No open section chosen for ${it.code}.` });
      else if ((sec.seats_open ?? 0) <= 0) issues.push({ ...base, type: "seat_full", severity: "high", message: `${it.code} section ${sec.section_code} is full.` });
      else if ((sec.seats_open ?? 0) <= SEAT_RISK_AT)
        issues.push({ ...base, type: "seat_risk", severity: "medium", message: `${it.code} has only ${sec.seats_open} seats left.` });

      return {
        id: it.id,
        courseId: it.course_id,
        code: it.code,
        title: it.title,
        credits: Number(it.credits),
        reason: it.reason,
        source: it.source,
        section: sec,
        issues,
      };
    })
  );

  const planIssues: Issue[] = [];
  for (let i = 0; i < outItems.length; i++)
    for (let j = i + 1; j < outItems.length; j++) {
      const a = outItems[i].section, b = outItems[j].section;
      if (a && b && overlaps(a, b)) {
        const msg = `${outItems[i].code} and ${outItems[j].code} meet at overlapping times.`;
        planIssues.push({ type: "time_conflict", severity: "high", message: msg });
        outItems[i].issues.push({ type: "time_conflict", severity: "high", message: msg, code: outItems[i].code, courseId: outItems[i].courseId });
        outItems[j].issues.push({ type: "time_conflict", severity: "high", message: msg, code: outItems[j].code, courseId: outItems[j].courseId });
      }
    }

  const credits = outItems.reduce((s, i) => s + i.credits, 0);
  const target: number = student.target_credits;
  if (credits > target + MAX_OVER_TARGET)
    planIssues.push({ type: "credits_over", severity: "medium", message: `${credits} credits is above the ${target}-credit target.` });
  if (outItems.length && credits < Math.min(9, target))
    planIssues.push({ type: "credits_under", severity: "medium", message: `${credits} credits is light for a ${target}-credit target.` });

  const allIssues = [...outItems.flatMap((i) => i.issues), ...planIssues];
  const events = (await sql`
    SELECT e.id, e.actor_type, e.action, e.detail, e.created_at, a.name AS advisor_name
    FROM plan_events e LEFT JOIN advisors a ON a.id = e.advisor_id
    WHERE e.plan_id = ${planId} ORDER BY e.created_at, e.id`) as any[];

  return {
    plan: {
      id: plan.id,
      studentId: plan.student_id,
      studentName: student.display_name,
      programName: student.program_name,
      name: plan.name,
      status: plan.status,
      createdBy: plan.created_by,
      modelName: plan.model_name,
      rationale: plan.rationale,
      approvedAt: plan.approved_at,
      approvedBy: plan.approved_by_name ?? null,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
    },
    term,
    items: outItems,
    totals: { credits, target, courses: outItems.length },
    issues: planIssues,
    blocking: allIssues.filter((i) => i.severity === "high").length,
    canApprove: outItems.length > 0 && !allIssues.some((i) => i.severity === "high"),
    events,
  };
}

// ---------------------------------------------------------------- editing

// Can this course be put in the plan (optionally replacing one item)?
export async function checkAddition(planId: number, courseId: number, replaceItemId?: number) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) throw new Error("Plan not found");
  const student = await getStudent(plan.student_id);
  const term = await getTerm();

  const [course] = (await sql`SELECT id, code, title, credits FROM courses WHERE id = ${courseId}`) as any[];
  if (!course) return { found: false as const };

  const others = (await sql`
    SELECT pi.id, pi.course_id, pi.section_id FROM plan_items pi
    WHERE pi.plan_id = ${planId} AND pi.id <> ${replaceItemId ?? 0}`) as any[];
  const duplicate = others.some((o) => o.course_id === courseId);

  const missing = await missingPrereqs(plan.student_id, courseId);
  const [passed] = (await sql`
    SELECT 1 FROM completed_courses WHERE student_id = ${plan.student_id} AND course_id = ${courseId}
      AND grade IS NOT NULL AND grade_passes(grade) LIMIT 1`) as any[];
  const [inProgram] = (await sql`
    SELECT 1 FROM program_requirements WHERE program_id = ${student.program_id} AND course_id = ${courseId} LIMIT 1`) as any[];

  const keptSecIds = others.map((o) => o.section_id).filter(Boolean);
  const kept = keptSecIds.length
    ? ((await sql`SELECT id, days, start_time::text AS start_time, end_time::text AS end_time, seats_open FROM sections WHERE id = ANY(${keptSecIds}::int[])`) as any[])
    : [];
  const secs = (await sectionsFor([courseId], term.id))[courseId] ?? [];
  const section = pickSection(secs, kept as Section[], student.preferences);

  const problems: Issue[] = [];
  const base = { courseId, code: course.code };
  if (duplicate) problems.push({ ...base, type: "already_completed", severity: "high", message: `${course.code} is already in this plan.` });
  if (passed) problems.push({ ...base, type: "already_completed", severity: "high", message: `${course.code} is already completed.` });
  if (missing.length)
    problems.push({ ...base, type: "not_eligible", severity: "high", message: `${course.code} needs ${missing.map(fmtGroup).join(" and ")} first.` });
  if (!inProgram) problems.push({ ...base, type: "not_in_program", severity: "low", message: `${course.code} is not a listed requirement for this program.` });
  if (!secs.length && !isSlot(course.code)) problems.push({ ...base, type: "no_section", severity: "high", message: `${course.code} has no section in ${term.name}.` });
  else if (!section && secs.length)
    problems.push({ ...base, type: "time_conflict", severity: "high", message: `Every open section of ${course.code} conflicts with the plan or is full.` });

  return {
    found: true as const,
    course,
    eligible: !missing.length && !passed,
    missing: missing.map(fmtGroup),
    section,
    problems,
    blocking: problems.some((p) => p.severity === "high"),
    termId: term.id,
  };
}

export async function logEvent(planId: number, advisorId: number | null, action: string, detail: object) {
  await sql`INSERT INTO plan_events (plan_id, actor_type, advisor_id, action, detail)
            VALUES (${planId}, 'advisor', ${advisorId}, ${action}, ${JSON.stringify(detail)}::jsonb)`;
}

// Any advisor edit puts the plan back in review and clears an old approval.
export async function touchPlan(planId: number) {
  await sql`UPDATE plans SET status = 'in_review', approved_at = NULL, approved_by = NULL,
            updated_at = NOW() WHERE id = ${planId}`;
}

// Alternatives for the swap dialog: eligible courses with sections, not already in the plan.
export async function alternatives(planId: number, itemId?: number) {
  const [plan] = (await sql`SELECT student_id FROM plans WHERE id = ${planId}`) as any[];
  if (!plan) return null;
  const term = await getTerm();
  const { cands } = await loadCandidates(plan.student_id, term.id);
  const inPlan = new Set(
    ((await sql`SELECT course_id FROM plan_items WHERE plan_id = ${planId} AND id <> ${itemId ?? 0}`) as any[]).map((r) => r.course_id)
  );
  return cands
    .filter((c) => !inPlan.has(c.course_id))
    .sort((a, b) => Number(b.critical_path) - Number(a.critical_path) || a.depth - b.depth || a.code.localeCompare(b.code))
    .map((c) => ({
      courseId: c.course_id,
      code: c.code,
      title: c.title,
      credits: c.credits,
      category: c.category,
      groupLabel: c.group_label,
      criticalPath: c.critical_path,
      depth: c.depth,
      isSlot: isSlot(c.code),
      seatsOpen: c.sections.length ? Math.max(...c.sections.map((s) => s.seats_open ?? 0)) : null,
    }));
}
