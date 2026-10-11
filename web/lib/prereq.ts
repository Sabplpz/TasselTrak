import { sql } from "@/lib/db";
import type { Term } from "@/lib/terms";
import { byId } from "@/lib/terms";

// ---------------------------------------------------------------- catalog

export type Course = { id: number; code: string; title: string; credits: number; typically_offered: string[] };

export async function loadCatalog(): Promise<Map<number, Course>> {
  const rows = (await sql`SELECT id, code, title, credits::float8 AS credits, typically_offered FROM courses`) as any[];
  return new Map(rows.map((r) => [r.id, r as Course]));
}

// ---------------------------------------------------------------- prerequisite graph

// courseId -> prerequisite groups. A course needs ONE course from EVERY group (AND of ORs).
export type Graph = Map<number, number[][]>;

export async function loadGraph(programId: number | null): Promise<Graph> {
  const rows = (await sql`
    SELECT course_id, required_course_id, group_no FROM prerequisites
    WHERE kind = 'prereq' AND (program_id IS NULL OR program_id = ${programId})
    ORDER BY course_id, group_no, required_course_id`) as any[];
  const tmp = new Map<number, Map<number, number[]>>();
  for (const r of rows) {
    const groups = tmp.get(r.course_id) ?? new Map<number, number[]>();
    groups.set(r.group_no, [...(groups.get(r.group_no) ?? []), r.required_course_id]);
    tmp.set(r.course_id, groups);
  }
  const g: Graph = new Map();
  for (const [cid, groups] of tmp) g.set(cid, [...groups.values()]);
  return g;
}

// ---------------------------------------------------------------- what the student has done

export type HistoryRow = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  grade: string | null;
  passed: boolean;
  inProgress: boolean;
  termId: number | null;
  termCode: string | null;
  termKey: number;
};

export type History = {
  rows: HistoryRow[];
  passed: Set<number>;
  inProgress: Map<number, number>; // courseId -> term key it is being taken in
};

// `fallbackKey` is used for rows with no term (treated as the current term).
export async function loadHistory(studentId: number, terms: Term[], fallbackKey: number): Promise<History> {
  const rows = (await sql`
    SELECT cc.course_id, c.code, c.title, c.credits::float8 AS credits, cc.grade, cc.term_id,
           grade_passes(cc.grade) AS passed
    FROM completed_courses cc JOIN courses c ON c.id = cc.course_id
    WHERE cc.student_id = ${studentId}`) as any[];
  const out: HistoryRow[] = rows.map((r) => {
    const t = r.term_id ? byId(terms, r.term_id) : null;
    return {
      courseId: r.course_id,
      code: r.code,
      title: r.title,
      credits: r.credits,
      grade: r.grade,
      passed: !!r.passed,
      inProgress: r.grade == null,
      termId: t?.id ?? null,
      termCode: t?.code ?? null,
      termKey: t?.key ?? fallbackKey,
    };
  });
  const passed = new Set<number>();
  const inProgress = new Map<number, number>();
  for (const r of out) {
    if (r.passed) passed.add(r.courseId);
    else if (r.inProgress) inProgress.set(r.courseId, r.termKey);
  }
  return { rows: out, passed, inProgress };
}

// ---------------------------------------------------------------- prerequisite checks

export type Planned = { courseId: number; termKey: number };

// A prerequisite counts for a course taken in the term with key `atKey` when the student has
// passed it, is taking it in an EARLIER term, or has it planned in an earlier term.
// (Taking both in the same term does not count: the prerequisite is not finished yet.)
export function unmetGroups(graph: Graph, courseId: number, atKey: number, h: History, planned: Planned[]): number[][] {
  const out: number[][] = [];
  for (const group of graph.get(courseId) ?? []) {
    const met = group.some(
      (r) =>
        h.passed.has(r) ||
        (h.inProgress.has(r) && (h.inProgress.get(r) as number) < atKey) ||
        planned.some((p) => p.courseId === r && p.termKey < atKey)
    );
    if (!met) out.push(group);
  }
  return out;
}

// For the "Needs COP 3503" / "Locked" tags: what is still not PASSED, whatever the term.
//   available = every prerequisite group is passed
//   needs     = the missing ones are being taken right now
//   locked    = at least one missing group has not been started
export function prereqStatus(graph: Graph, courseId: number, h: History) {
  const waiting: { ids: number[]; state: "in_progress" | "later" }[] = [];
  for (const group of graph.get(courseId) ?? []) {
    if (group.some((r) => h.passed.has(r))) continue;
    const ip = group.find((r) => h.inProgress.has(r));
    waiting.push(ip != null ? { ids: [ip], state: "in_progress" } : { ids: group, state: "later" });
  }
  const status = !waiting.length ? "available" : waiting.some((w) => w.state === "later") ? "locked" : "needs";
  return { status: status as "available" | "needs" | "locked", waiting };
}
