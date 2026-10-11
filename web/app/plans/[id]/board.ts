import type { CourseState } from "@/components/CourseNode";

// ---- API shapes (only the fields the board reads)

export type PlanIssue = { type: string; severity: "high" | "medium" | "low"; message: string };

export type PlanItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  credits: number;
  reason: string | null;
  source: "ai" | "advisor";
  section: {
    section_code: string | null;
    modality: string | null;
    days: string[] | null;
    start_time: string | null;
    end_time: string | null;
    capacity: number | null;
    seats_open: number | null;
    instructor: string | null;
  } | null;
  issues: PlanIssue[];
};

// GET /api/plans/:id
export type PlanResponse = {
  plan: {
    id: number;
    studentId: number;
    studentName: string;
    programName: string | null;
    status: "draft" | "in_review" | "approved" | "archived";
    createdBy: "ai" | "advisor";
    modelName: string | null;
    rationale: string | null;
  };
  term: { code: string; name: string };
  items: PlanItem[];
  totals: { credits: number; target: number; courses: number };
  issues: PlanIssue[];
};

// GET /api/students/:id
export type StudentResponse = {
  student: { expected_graduation: string | null };
  completed: {
    code: string;
    title: string;
    credits: number;
    grade: string | null;
    term: string | null;
    in_progress: boolean;
  }[];
  remaining: {
    course_id: number;
    code: string;
    title: string;
    credits: number;
    category: string | null;
    group_label: string | null;
    critical_path: boolean;
    depth: number;
    eligible: boolean;
  }[];
};

// GET /api/plans/:id/prerequisites
export type Prerequisite = {
  courseCode: string;
  requiredCode: string;
  kind: "prereq" | "coreq";
  groupNo: number;
  minGrade: string | null;
};

// ---- Board model

// Geometry of the Figma canvas at 100%: 208 x 108 notes, 56px between columns, 45px between rows.
export const NODE_W = 208;
export const NODE_H = 108;
export const COL_GAP = 56;
export const ROW_GAP = 45;
const COL_PITCH = NODE_W + COL_GAP;
const ROW_PITCH = NODE_H + ROW_GAP;
export const HEADER_H = 42;
const FIRST_ROW_Y = HEADER_H + ROW_GAP;

export type BoardCourse = {
  id: string;
  code: string;
  title: string;
  credits: number;
  state: CourseState;
  status?: string; // replaces the state's default label
  blocked?: boolean;
  grade?: string | null;
  where: "term" | "plan" | "unplanned";
  termLabel: string;
  criticalPath: boolean;
  fills: string | null;
  item?: PlanItem;
  badge?: { kind: "lock" | "clock" | "warning"; text: string };
  column: number;
  x: number;
  y: number;
};

export type BoardColumn = {
  id: string;
  title: string;
  sub: string;
  now: boolean;
  where: BoardCourse["where"];
  x: number;
  width: number;
  addY?: number; // where the disabled "Add course" placeholder sits
};

export type BoardEdge = { id: string; source: string; target: string };

export type Board = { columns: BoardColumn[]; courses: BoardCourse[]; edges: BoardEdge[] };

const SEASONS: Record<string, number> = { spring: 1, summer: 2, fall: 3 };

// "Fall 2026" -> 20263, so terms sort in calendar order. Names that don't parse go last.
function termOrder(name: string) {
  const m = /^(\w+)\s+(\d{4})$/.exec(name.trim());
  const season = m ? SEASONS[m[1].toLowerCase()] : undefined;
  return m && season ? Number(m[2]) * 10 + season : Number.MAX_SAFE_INTEGER;
}

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const cr = (n: number) => `${n} cr`;
const sum = (rows: { credits: number }[]) => rows.reduce((total, r) => total + r.credits, 0);

// "COP 3503C needs COP 3502C first." -> "Needs COP 3502C first"
function needsText(issue: PlanIssue, code: string) {
  const text = issue.message.replace(`${code} `, "").replace(/\.$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function badgeFor(item: PlanItem): BoardCourse["badge"] {
  const issue = item.issues.find((i) => i.severity === "high");
  if (!issue) return undefined;
  if (issue.type === "not_eligible") return { kind: "lock", text: needsText(issue, item.code) };
  if (issue.type === "time_conflict") return { kind: "clock", text: "Time clash" };
  return { kind: "warning", text: humanize(issue.type) };
}

export function buildBoard(plan: PlanResponse, student: StudentResponse, prerequisites: Prerequisite[]): Board {
  const columns: BoardColumn[] = [];
  const courses: BoardCourse[] = [];
  const remainingById = new Map(student.remaining.map((r) => [r.course_id, r]));
  const fillsOf = (r?: StudentResponse["remaining"][number]) =>
    r ? humanize(r.group_label ?? r.category ?? "") || null : null;

  const place = (column: number, row: number) => ({ column, x: column * COL_PITCH, y: FIRST_ROW_Y + row * ROW_PITCH });

  // 1. Past and current terms, from the student's transcript.
  const byTerm = new Map<string, StudentResponse["completed"]>();
  for (const c of student.completed) {
    const term = c.term ?? "Unknown term";
    byTerm.set(term, [...(byTerm.get(term) ?? []), c]);
  }
  const termNames = [...byTerm.keys()].filter((t) => t !== plan.term.name).sort((a, b) => termOrder(a) - termOrder(b));
  const nowTerm = [...termNames].reverse().find((t) => byTerm.get(t)!.some((c) => c.in_progress));

  for (const term of termNames) {
    const rows = byTerm.get(term)!;
    const column = columns.length;
    const now = term === nowTerm;
    columns.push({
      id: `term:${term}`,
      title: term,
      sub: `${now ? "In progress" : "Completed"} · ${cr(sum(rows))}`,
      now,
      where: "term",
      x: column * COL_PITCH,
      width: NODE_W,
    });
    rows.forEach((c, row) =>
      courses.push({
        id: `${term}:${c.code}`,
        code: c.code,
        title: c.title,
        credits: c.credits,
        state: c.in_progress ? "in-progress" : "taken",
        grade: c.grade,
        where: "term",
        termLabel: term,
        criticalPath: false,
        fills: null,
        ...place(column, row),
      }),
    );
  }

  // 2. The plan's term.
  const planColumn = columns.length;
  columns.push({
    id: `plan:${plan.term.name}`,
    title: plan.term.name,
    sub: `Up next · ${cr(plan.totals.credits)}`,
    now: false,
    where: "plan",
    x: planColumn * COL_PITCH,
    width: NODE_W,
    addY: FIRST_ROW_Y + plan.items.length * ROW_PITCH,
  });
  plan.items.forEach((item, row) => {
    const notEligible = item.issues.find((i) => i.type === "not_eligible");
    const required = remainingById.get(item.courseId);
    const suggested = item.source === "ai";
    courses.push({
      id: `plan:${item.code}`,
      code: item.code,
      title: item.title,
      credits: item.credits,
      state: suggested ? "suggested" : notEligible ? "locked" : "available",
      status: notEligible ? needsText(notEligible, item.code).replace(/ first$/, "") : undefined,
      blocked: !!notEligible,
      where: "plan",
      termLabel: plan.term.name,
      criticalPath: required?.critical_path ?? false,
      fills: fillsOf(required),
      item,
      badge: badgeFor(item),
      ...place(planColumn, row),
    });
  });

  // 3. Everything still required and not in the plan, by depth, wrapped into columns no taller
  //    than the tallest term so the board stays a rectangle.
  const planned = new Set(plan.items.map((i) => i.courseId));
  const unplanned = student.remaining
    .filter((r) => !planned.has(r.course_id))
    .sort((a, b) => a.depth - b.depth || Number(b.critical_path) - Number(a.critical_path) || a.code.localeCompare(b.code));
  if (unplanned.length > 0) {
    const firstColumn = columns.length;
    const rowsPerColumn = Math.max(6, plan.items.length + 1, ...[...byTerm.values()].map((rows) => rows.length));
    const span = Math.ceil(unplanned.length / rowsPerColumn);
    columns.push({
      id: "unplanned",
      title: "Not yet planned",
      sub: `${unplanned.length} ${unplanned.length === 1 ? "course" : "courses"} · ${cr(sum(unplanned))}`,
      now: false,
      where: "unplanned",
      x: firstColumn * COL_PITCH,
      width: (span - 1) * COL_PITCH + NODE_W,
    });
    unplanned.forEach((r, i) =>
      courses.push({
        id: `unplanned:${r.code}`,
        code: r.code,
        title: r.title,
        credits: r.credits,
        state: r.eligible ? "available" : "locked",
        where: "unplanned",
        termLabel: "Not yet planned",
        criticalPath: r.critical_path,
        fills: fillsOf(r),
        ...place(firstColumn + Math.floor(i / rowsPerColumn), i % rowsPerColumn),
      }),
    );
  }

  // 4. Connectors: one per prerequisite pair that has both ends on the board. A course can be on
  //    the board twice (a failed attempt and its planned retake), so prefer left-to-right pairs.
  const byCode = new Map<string, BoardCourse[]>();
  for (const c of courses) byCode.set(c.code, [...(byCode.get(c.code) ?? []), c]);
  const edges = new Map<string, BoardEdge>();
  for (const p of prerequisites) {
    const sources = byCode.get(p.requiredCode) ?? [];
    const targets = byCode.get(p.courseCode) ?? [];
    const pairs = sources.flatMap((s) => targets.map((t) => [s, t] as const)).filter(([s, t]) => s.id !== t.id);
    const forward = pairs.filter(([s, t]) => s.column < t.column);
    for (const [s, t] of forward.length > 0 ? forward : pairs) {
      const id = `${s.id}->${t.id}`;
      edges.set(id, { id, source: s.id, target: t.id });
    }
  }

  return { columns, courses, edges: [...edges.values()] };
}

// Prerequisite groups of one course: every group is needed, any one course in a group satisfies it.
export function prerequisiteGroups(code: string, prerequisites: Prerequisite[]) {
  const groups = new Map<string, { kind: Prerequisite["kind"]; codes: string[] }>();
  for (const p of prerequisites) {
    if (p.courseCode !== code) continue;
    const key = `${p.kind}:${p.groupNo}`;
    const group = groups.get(key) ?? { kind: p.kind, codes: [] };
    if (!group.codes.includes(p.requiredCode)) group.codes.push(p.requiredCode);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Codes of the courses that list `code` as a prerequisite.
export function unlockedBy(code: string, prerequisites: Prerequisite[]) {
  return [...new Set(prerequisites.filter((p) => p.requiredCode === code && p.kind === "prereq").map((p) => p.courseCode))];
}
