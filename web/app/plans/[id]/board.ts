import type { CourseState } from "@/components/CourseNode";
import type { CourseOptions, PlanIssue, PlanItem, PlanResponse, Prerequisite, StudentExtras, TermRef } from "@/lib/planApi";

// ---- Icons shared by the canvas and the side panel

export const STATE_ICON: Record<CourseState, string> = {
  taken: "/login/icon-taken.svg",
  "in-progress": "/login/icon-in-progress.svg",
  available: "/login/icon-available.svg",
  locked: "/login/icon-locked.svg",
  suggested: "/plan/suggested.svg",
};

export const BADGE_ICON = {
  lock: "/plan/conflict-lock.svg",
  clock: "/plan/conflict-clock.svg",
  warning: "/advisor/risk-high.svg",
};

// ---- Board model

// Geometry of the Figma canvas at 100%: 208 x 108 notes, 56px between columns, 45px between rows.
export const NODE_W = 208;
export const NODE_H = 108;
export const COL_GAP = 56;
export const ROW_GAP = 45;
const REGION_GAP = 56; // extra space between the terms and "Not yet planned"
const ADD_H = 36; // height of the "Add course" placeholder
const COL_PITCH = NODE_W + COL_GAP;
const ROW_PITCH = NODE_H + ROW_GAP;
export const HEADER_H = 42;
const FIRST_ROW_Y = HEADER_H + ROW_GAP;

export type BoardCourse = {
  id: string;
  courseId: number;
  code: string;
  title: string;
  credits: number;
  state: CourseState;
  status?: string; // replaces the state's default label
  blocked?: boolean;
  grade?: string | null;
  where: "term" | "plan" | "unplanned";
  // What dragging this note means. "plan": it is in the plan and can move to another plan term or
  // leave the plan. "unplanned": it can be added to a plan term. null: not draggable.
  drag: "plan" | "unplanned" | null;
  termCode: string | null;
  termLabel: string;
  criticalPath: boolean;
  fills: string | null;
  item?: PlanItem;
  // For a course that is not planned yet: whether each plan term would take it, and if not, what
  // it is waiting on. A term that is missing here is one the API gave no answer for.
  fit: Record<string, { met: boolean; missing: string[] }>;
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
  termCode: string | null;
  x: number;
  width: number;
  addY?: number; // where the "Add course" button sits (plan terms only)
  groups?: BoardGroup[]; // subheadings inside "Not yet planned"
};

export type BoardGroup = { label: string; state: "available" | "locked"; count: number; x: number };

export type BoardEdge = { id: string; source: string; target: string };

// `bottom` is the lowest point any column reaches, so the term bands can all run the full height.
export type Board = { columns: BoardColumn[]; courses: BoardCourse[]; edges: BoardEdge[]; bottom: number };

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const cr = (n: number) => `${n} cr`;
const sum = (rows: { credits: number }[]) => rows.reduce((total, r) => total + r.credits, 0);

// ["COP 3503C", "MAC 2312"] -> "Needs COP 3503C +1"
const needsLabel = (needs: string[]) => (needs.length ? `Needs ${needs[0]}${needs.length > 1 ? ` +${needs.length - 1}` : ""}` : undefined);

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

// The term after `term` on the calendar, skipping summer, the way the planner counts terms:
// "spring-2027" -> fall-2027, "fall-2027" -> spring-2028. null if the code has another shape.
export function termAfter(term: TermRef): TermRef | null {
  const m = /^(spring|summer|fall)-(\d{4})$/.exec(term.code);
  if (!m) return null;
  const [season, year] = m[1] === "fall" ? ["spring", Number(m[2]) + 1] : ["fall", Number(m[2])];
  return { code: `${season}-${year}`, name: `${humanize(season)} ${year}` };
}

// The plan terms the board shows: every planned term in the plan object (or its first term when
// it has no courses yet), plus `later`, an empty term to move courses into.
export function planTerms(plan: PlanResponse, later: TermRef | null): TermRef[] {
  const planned = plan.terms.filter((t) => t.state === "planned").map((t) => ({ code: t.code, name: t.name }));
  const terms = planned.length > 0 ? planned : [plan.term];
  return later && !terms.some((t) => t.code === later.code) ? [...terms, later] : terms;
}

// `options` is the course-options answer for each plan term, keyed by term code. `later` is the
// empty plan term after the last one (see planTerms); pass null to leave it out.
export function buildBoard(
  plan: PlanResponse,
  options: Record<string, CourseOptions>,
  prerequisites: Prerequisite[],
  extras: StudentExtras | null,
  later: TermRef | null,
): Board {
  const columns: BoardColumn[] = [];
  const courses: BoardCourse[] = [];
  const editable = !plan.readOnly;
  const place = (column: number, row: number) => ({ column, x: column * COL_PITCH, y: FIRST_ROW_Y + row * ROW_PITCH });

  // 1. Past and current terms, from the plan's history.
  for (const term of plan.terms.filter((t) => t.state !== "planned")) {
    const rows = plan.history.filter((h) => h.termCode === term.code);
    const column = columns.length;
    columns.push({
      id: `term:${term.code}`,
      title: term.name,
      sub: `${term.label} · ${cr(term.credits)}`,
      now: term.now,
      where: "term",
      termCode: term.code,
      x: column * COL_PITCH,
      width: NODE_W,
    });
    rows.forEach((h, row) =>
      courses.push({
        id: `${term.code}:${h.code}`,
        courseId: h.courseId,
        code: h.code,
        title: h.title,
        credits: h.credits,
        state: h.status === "in_progress" ? "in-progress" : "taken",
        status: h.status === "not_passed" ? "Not passed" : undefined,
        grade: h.grade,
        where: "term",
        drag: null,
        termCode: term.code,
        termLabel: term.name,
        criticalPath: false,
        fills: null,
        fit: {},
        ...place(column, row),
      }),
    );
  }

  // 2. One column per plan term.
  const terms = planTerms(plan, later);
  for (const term of terms) {
    const info = plan.terms.find((t) => t.code === term.code);
    const items = plan.items.filter((i) => i.termCode === term.code);
    const column = columns.length;
    columns.push({
      id: `plan:${term.code}`,
      title: term.name,
      sub: `${info?.label ?? "Later"} · ${cr(sum(items))}`,
      now: false,
      where: "plan",
      termCode: term.code,
      x: column * COL_PITCH,
      width: NODE_W,
      addY: FIRST_ROW_Y + items.length * ROW_PITCH,
    });
    items.forEach((item, row) => {
      const waiting = item.status !== "available";
      courses.push({
        id: `plan:${item.code}`,
        courseId: item.courseId,
        code: item.code,
        title: item.title,
        credits: item.credits,
        state: item.suggested ? "suggested" : waiting ? "locked" : "available",
        status: waiting ? (needsLabel(item.needs) ?? "Locked") : undefined,
        blocked: waiting,
        where: "plan",
        drag: editable ? "plan" : null,
        termCode: term.code,
        termLabel: term.name,
        criticalPath: extras?.critical.has(item.courseId) ?? false,
        fills: item.fills ? humanize(item.fills) : null,
        item,
        fit: {},
        badge: badgeFor(item),
        ...place(column, row),
      });
    });
  }

  // 3. Everything that can still be added, from the picker's own list. It is its own region, set
  //    apart from the terms by a gap. "Available now" and "Locked" are judged for the first plan
  //    term; `fit` keeps the answer for every plan term, for dragging.
  const first = options[terms[0].code];
  if (first) {
    const fit = new Map<number, BoardCourse["fit"]>();
    for (const term of terms) {
      for (const group of options[term.code]?.groups ?? []) {
        for (const c of group.courses) {
          fit.set(c.courseId, { ...fit.get(c.courseId), [term.code]: { met: c.prerequisitesMet, missing: c.missing } });
        }
      }
    }
    const unplanned = first.groups
      .flatMap((group) => group.courses.map((c) => ({ ...c, fills: humanize(group.fills ?? group.requirement) })))
      .sort(
        (a, b) =>
          (extras?.depth.get(a.courseId) ?? 99) - (extras?.depth.get(b.courseId) ?? 99) ||
          Number(b.criticalPath) - Number(a.criticalPath) ||
          a.code.localeCompare(b.code),
      );
    if (unplanned.length > 0) {
      const tallest = Math.max(
        ...plan.terms.map((t) => (t.state === "planned" ? plan.items : plan.history).filter((c) => c.termCode === t.code).length),
        0,
      );
      const rowsPerColumn = Math.max(6, tallest + 1);
      const regionX = columns.length * COL_PITCH + REGION_GAP;
      const groups: BoardGroup[] = [];
      let nextColumn = 0;
      for (const [label, state] of [["Available now", "available"], ["Locked", "locked"]] as const) {
        const rows = unplanned.filter((c) => c.prerequisitesMet === (state === "available"));
        if (rows.length === 0) continue;
        groups.push({ label, state, count: rows.length, x: regionX + nextColumn * COL_PITCH });
        rows.forEach((c, i) => {
          const column = nextColumn + Math.floor(i / rowsPerColumn);
          courses.push({
            id: `unplanned:${c.code}`,
            courseId: c.courseId,
            code: c.code,
            title: c.title,
            credits: c.credits,
            state,
            status: state === "locked" ? (needsLabel(c.missing) ?? "Locked") : undefined,
            where: "unplanned",
            drag: editable ? "unplanned" : null,
            termCode: null,
            termLabel: "Not yet planned",
            criticalPath: c.criticalPath,
            fills: c.fills,
            fit: fit.get(c.courseId) ?? {},
            column: columns.length + column,
            x: regionX + column * COL_PITCH,
            y: FIRST_ROW_Y + (i % rowsPerColumn) * ROW_PITCH,
          });
        });
        nextColumn += Math.ceil(rows.length / rowsPerColumn);
      }
      columns.push({
        id: "unplanned",
        title: "Not yet planned",
        sub: `${unplanned.length} ${unplanned.length === 1 ? "course" : "courses"} · ${cr(sum(unplanned))}`,
        now: false,
        where: "unplanned",
        termCode: null,
        x: regionX,
        width: (nextColumn - 1) * COL_PITCH + NODE_W,
        groups,
      });
    }
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

  const bottom = Math.max(
    FIRST_ROW_Y + NODE_H,
    ...courses.map((c) => c.y + NODE_H),
    ...columns.map((c) => (c.addY ?? 0) + ADD_H),
  );
  return { columns, courses, edges: [...edges.values()], bottom };
}

// Course codes inside "what it needs" strings such as "COP 3502C" or "one of MAC 2311C / MAC 2281".
export const codesIn = (needs: string[]) => needs.flatMap((n) => n.match(/[A-Z]{2,4} [A-Z0-9]{3,5}/g) ?? []);

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
