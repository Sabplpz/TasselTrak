"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink } from "@/components/Button";
import { Avatar, Pill, PlanStatusChip } from "@/components/Chip";
import { CourseNode, SuggestedTag, type CourseState } from "@/components/CourseNode";
import { Skeleton, StateMessage } from "@/components/State";
import { FetchError, getJson, reasonOf } from "@/lib/fetchJson";
import type { Advisor } from "@/lib/useAdvisorSession";
import {
  buildBoard,
  COL_GAP,
  ROW_GAP,
  prerequisiteGroups,
  unlockedBy,
  HEADER_H,
  NODE_H,
  NODE_W,
  type Board,
  type BoardColumn,
  type BoardCourse,
  type PlanResponse,
  type Prerequisite,
  type StudentResponse,
} from "./board";

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; reason: string }
  | { status: "ready"; plan: PlanResponse; student: StudentResponse; prerequisites: Prerequisite[] };

const STATE_ICON: Record<CourseState, string> = {
  taken: "/login/icon-taken.svg",
  "in-progress": "/login/icon-in-progress.svg",
  available: "/login/icon-available.svg",
  locked: "/login/icon-locked.svg",
  suggested: "/plan/suggested.svg",
};

const BADGE_ICON = {
  lock: "/plan/conflict-lock.svg",
  clock: "/plan/conflict-clock.svg",
  warning: "/advisor/risk-high.svg",
};

const LABEL = "text-overline-12 uppercase whitespace-nowrap text-ink-secondary";

// ---------------------------------------------------------------- board nodes

type CourseData = { course: BoardCourse; selected: boolean; dimmed: boolean; onSelect: (id: string) => void };

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: "none" } as const;

function CourseFlowNode({ data }: NodeProps<Node<CourseData>>) {
  const { course, selected, dimmed, onSelect } = data;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(course.id)}
      className={`relative block cursor-pointer rounded-card text-left transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-primary ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      <CourseNode
        code={course.code}
        title={course.title}
        credits={`${course.credits} cr`}
        state={course.state}
        status={course.status}
        blocked={course.blocked}
        grade={course.grade}
        selected={selected}
      />
      {course.badge && (
        <span className="pointer-events-none absolute -inset-[3px] rounded-[18px] border-[2.5px] border-ink-primary" />
      )}
      {course.criticalPath && (
        <span className="absolute -top-[11px] left-2">
          <Pill tone="gold">Critical path</Pill>
        </span>
      )}
      {course.badge && (
        <span className="absolute -bottom-[14px] left-2 flex max-w-[196px] items-center gap-[5px] rounded-pill bg-ink-primary py-[3px] pl-[7px] pr-[10px] text-caption-12 text-surface-card">
          <Image src={BADGE_ICON[course.badge.kind]} alt="" width={16} height={16} className="flex-none" />
          <span className="truncate">{course.badge.text}</span>
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </button>
  );
}

function TermFlowNode({ data }: NodeProps<Node<{ column: BoardColumn }>>) {
  const { column } = data;
  return (
    <div className="flex flex-col gap-0.5 pl-1" style={{ width: column.width }}>
      <div className="flex h-6 items-center gap-2">
        <h2 className="text-title-18 whitespace-nowrap text-ink-primary">{column.title}</h2>
        {column.now && <Pill tone="gold">Now</Pill>}
      </div>
      <p className="text-caption-12-regular whitespace-nowrap text-ink-muted">{column.sub}</p>
    </div>
  );
}

function AddFlowNode() {
  return (
    <button
      type="button"
      disabled
      style={{ width: NODE_W }}
      className="cursor-not-allowed rounded-field border-[1.5px] border-dashed border-ink-muted py-2 text-caption-12 whitespace-pre text-ink-secondary opacity-60"
    >
      {"+  Add course"}
    </button>
  );
}

// Connector that stays in the gaps between notes: out of the source into the column gap beside it,
// along the row gap above the target, then down the column gap in front of the target and in.
function lanePath(sx: number, sy: number, tx: number, ty: number) {
  const outX = sx + COL_GAP / 2;
  const inX = tx - COL_GAP / 2;
  const laneY = ty - NODE_H / 2 - ROW_GAP / 2;
  const raw: [number, number][] =
    outX === inX
      ? [[sx, sy], [outX, sy], [outX, ty], [tx, ty]]
      : [[sx, sy], [outX, sy], [outX, laneY], [inX, laneY], [inX, ty], [tx, ty]];
  // Drop repeated points, then round each remaining corner.
  const points = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1];
    const r = Math.min(10, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r, ay = y - Math.sign(y - py) * r;
    const bx = x + Math.sign(nx - x) * r, by = y + Math.sign(ny - y) * r;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

function LaneEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  return <BaseEdge path={lanePath(sourceX, sourceY, targetX, targetY)} style={style} markerEnd={markerEnd} />;
}

const EDGE_TYPES = { lane: LaneEdge };

// Room around the fitted board. The legend and zoom control sit over the bottom edge.
const FIT = { top: 28, side: 28, bottom: 88, minZoom: 0.5 };

// Opening view: the term columns (transcript + this plan) fitted to the canvas. If that would
// shrink the notes below half size, stay at half size and start from the top-left instead, so the
// board opens readable and the rest is a pan away. "Not yet planned" continues to the right.
function openingViewport(board: Board, width: number, height: number) {
  const terms = board.columns.filter((column) => column.where !== "unplanned");
  const right = Math.max(...terms.map((column) => column.x + column.width));
  const bottom = Math.max(HEADER_H, ...board.courses.filter((c) => c.where !== "unplanned").map((c) => c.y + NODE_H));
  const fit = Math.min((width - FIT.side * 2) / right, (height - FIT.top - FIT.bottom) / bottom);
  const zoom = Math.min(1, Math.max(FIT.minZoom, fit));
  return { x: FIT.side, y: FIT.top, zoom };
}

const NODE_TYPES = { course: CourseFlowNode, term: TermFlowNode, add: AddFlowNode };

// ---------------------------------------------------------------- canvas overlays

const OVERLAY =
  "flex items-center rounded-card border border-border-subtle bg-surface-card px-4 py-[10px] shadow-note";

function Legend() {
  const entries: [CourseState, string][] = [
    ["taken", "Taken"],
    ["in-progress", "In progress"],
    ["available", "Available now"],
    ["locked", "Locked"],
    ["suggested", "Suggested"],
  ];
  return (
    <Panel position="bottom-left" style={{ margin: 24 }}>
      <ul className={`${OVERLAY} flex-wrap gap-x-[18px] gap-y-2`}>
        {entries.map(([state, label]) => (
          <li key={state} className="flex items-center gap-1.5 text-caption-12 whitespace-nowrap text-ink-secondary">
            <Image src={STATE_ICON[state]} alt="" width={18} height={18} />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-caption-12 whitespace-nowrap text-ink-secondary max-xl:hidden">
          <span className="h-[3px] w-6 rounded-pill bg-line-default" />
          Prerequisite
        </li>
      </ul>
    </Panel>
  );
}

function ZoomControl() {
  const { zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  const step = "cursor-pointer px-1 text-label-16 text-ink-secondary hover:text-ink-primary";
  return (
    <Panel position="bottom-right" style={{ margin: 24 }}>
      <div className={`${OVERLAY} gap-[14px]`}>
        <button type="button" aria-label="Zoom out" className={step} onClick={() => zoomOut({ duration: 150 })}>
          −
        </button>
        <span className="min-w-9 text-center text-caption-12 text-ink-primary">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" className={step} onClick={() => zoomIn({ duration: 150 })}>
          +
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- side panel

function CourseRef({ code, board }: { code: string; board: Board }) {
  // A course can be on the board twice (a failed attempt and its retake): describe the latest.
  const course = board.courses.filter((c) => c.code === code).at(-1);
  const status = !course
    ? "Not on this board"
    : course.state === "taken"
      ? "Taken"
      : course.state === "in-progress"
        ? "In progress"
        : course.where === "plan"
          ? "In this plan"
          : "Not yet planned";
  return (
    <li className="flex items-center gap-2 py-[7px]">
      {course && <Image src={STATE_ICON[course.state]} alt="" width={18} height={18} className="flex-none" />}
      <span className="flex-none text-label-14 text-ink-primary">{code}</span>
      <span className="min-w-0 flex-1 truncate text-body-14 text-ink-secondary">{course?.title}</span>
      {course?.grade ? (
        <span className="flex-none rounded-pill bg-ink-primary px-[9px] py-0.5 text-caption-12 text-surface-card">
          {course.grade}
        </span>
      ) : (
        <span className="flex-none text-caption-12-regular text-ink-secondary">{status}</span>
      )}
    </li>
  );
}

const time = (t: string | null) => t?.slice(0, 5) ?? "";

function SelectedCourse({
  course,
  board,
  prerequisites,
  onClose,
}: {
  course: BoardCourse;
  board: Board;
  prerequisites: Prerequisite[];
  onClose: () => void;
}) {
  const groups = prerequisiteGroups(course.code, prerequisites);
  const unlocks = unlockedBy(course.code, prerequisites);
  const section = course.item?.section;

  return (
    <section
      aria-label={`${course.code} details`}
      className="flex flex-none flex-col gap-3 rounded-card border-[1.5px] border-ink-primary bg-surface-canvas px-4 py-[14px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="text-title-18 whitespace-nowrap text-ink-primary">{course.code}</h2>
          {course.state === "suggested" && <SuggestedTag />}
          {course.criticalPath && <Pill tone="gold">Critical path</Pill>}
        </div>
        <div className="flex flex-none items-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close course details"
            className="cursor-pointer rounded-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary"
          >
            <Image src="/advisor/close.svg" alt="" width={28} height={28} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="text-body-14 text-ink-primary">
          {course.title} · {course.termLabel} · {course.credits} cr
        </p>
        {course.fills && <p className="text-caption-12-regular text-ink-secondary">Fills: {course.fills}</p>}
      </div>

      {course.item && (
        <div className="flex flex-wrap gap-2">
          <Button variant="gold" size="sm" full={false} disabled>
            Confirm
          </Button>
          <Button variant="secondary" size="sm" full={false} disabled>
            Swap
          </Button>
          <Button variant="secondary" size="sm" full={false} disabled>
            Remove
          </Button>
        </div>
      )}

      {course.item?.reason && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Why this course</h3>
          <p className="text-body-14 text-ink-primary">{course.item.reason}</p>
        </div>
      )}

      {section && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Section</h3>
          <p className="text-body-14 text-ink-primary">
            {[
              section.section_code && `Section ${section.section_code}`,
              section.days?.length ? `${section.days.join(" ")} ${time(section.start_time)}–${time(section.end_time)}` : null,
              section.modality,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-caption-12-regular text-ink-secondary">
            {[
              section.instructor && `Instructor: ${section.instructor}`,
              section.seats_open !== null &&
                section.capacity !== null &&
                `${section.seats_open} of ${section.capacity} seats open`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}

      {course.item && course.item.issues.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Issues</h3>
          <ul className="flex flex-col gap-1 text-body-14 text-ink-primary">
            {course.item.issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-1">
          <h3 className={LABEL}>Prerequisites</h3>
        </div>
        {groups.length === 0 ? (
          <p className="text-body-14 text-ink-secondary">None listed.</p>
        ) : (
          groups.map((group, i) => (
            <div key={i} className="border-t border-border-subtle">
              {(group.codes.length > 1 || group.kind === "coreq") && (
                <p className="pt-[7px] text-caption-12-regular text-ink-secondary">
                  {group.kind === "coreq" ? "Corequisite" : "One of"}
                </p>
              )}
              <ul>
                {group.codes.map((code) => (
                  <CourseRef key={code} code={code} board={board} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className={LABEL}>Unlocks</h3>
          {unlocks.length > 0 && (
            <span className="text-caption-12-regular text-ink-secondary">
              {unlocks.length} {unlocks.length === 1 ? "course" : "courses"}
            </span>
          )}
        </div>
        {unlocks.length === 0 ? (
          <p className="text-body-14 text-ink-secondary">Nothing listed.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {unlocks.map((code) => (
              <li
                key={code}
                className="rounded-pill border-[1.5px] border-border-default bg-surface-card px-[10px] py-[3px] text-caption-12 text-ink-primary"
              >
                {code}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PlanPanel({
  plan,
  board,
  prerequisites,
  selected,
  onSelect,
}: {
  plan: PlanResponse;
  board: Board;
  prerequisites: Prerequisite[];
  selected: BoardCourse | null;
  onSelect: (id: string | null) => void;
}) {
  const { credits, target, courses } = plan.totals;
  const planned = board.courses.filter((c) => c.where === "plan");

  return (
    <aside
      aria-label="Plan details"
      className="my-3 mr-4 flex w-[368px] flex-none flex-col gap-[22px] overflow-y-auto rounded-panel border border-border-subtle bg-surface-card p-5 shadow-panel short:gap-4 short:p-4 max-md:hidden"
    >
      {selected && (
        <SelectedCourse course={selected} board={board} prerequisites={prerequisites} onClose={() => onSelect(null)} />
      )}

      <section className="flex flex-none flex-col gap-[10px]">
        <h2 className={LABEL}>Why this plan</h2>
        <p className="text-body-14 text-ink-primary">{plan.plan.rationale ?? "No rationale was recorded for this plan."}</p>
        <p className="text-caption-12-regular text-ink-secondary">
          {plan.plan.createdBy === "ai" ? "Drafted by AI" : "Created by an advisor"}
          {plan.plan.modelName ? ` · ${plan.plan.modelName}` : ""}
        </p>
      </section>

      <section className="flex flex-none flex-col gap-[10px]">
        <h2 className={LABEL}>Credits per term</h2>
        <div className="flex items-center gap-[10px]">
          <span className="w-[92px] flex-none text-body-14 text-ink-primary">{plan.term.name}</span>
          <span className="h-2 min-w-0 flex-1 overflow-clip rounded-pill border border-border-default bg-surface-sunken">
            <span
              className="block h-full bg-ink-primary"
              style={{ width: `${target > 0 ? Math.min(100, (credits / target) * 100) : 0}%` }}
            />
          </span>
          <span className="flex-none text-label-14 whitespace-nowrap text-ink-primary">{credits} cr</span>
        </div>
        <p className="text-caption-12-regular text-ink-secondary">Target: {target} cr</p>
        {plan.issues.length > 0 && (
          <ul className="flex flex-col gap-1 text-body-14 text-ink-primary">
            {plan.issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-none flex-col gap-[10px]">
        <div className="flex items-center justify-between">
          <h2 className={LABEL}>Courses in this plan</h2>
          <span className="text-caption-12-regular whitespace-nowrap text-ink-secondary">
            {courses} {courses === 1 ? "course" : "courses"} · {credits} cr
          </span>
        </div>
        {planned.length === 0 ? (
          <p className="text-body-14 text-ink-secondary">This plan has no courses yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {planned.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === c.id}
                  onClick={() => onSelect(c.id)}
                  className={`flex cursor-pointer items-center gap-[5px] rounded-pill border-[1.5px] py-[3px] pr-[10px] text-caption-12 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary ${
                    c.badge
                      ? "border-ink-primary bg-ink-primary pl-[7px] text-surface-card"
                      : c.state === "suggested"
                        ? "border-brand-gold bg-brand-gold-soft pl-[7px] text-ink-primary"
                        : "border-border-default bg-surface-card pl-[10px] text-ink-primary"
                  }`}
                >
                  {c.badge ? (
                    <Image src={BADGE_ICON[c.badge.kind]} alt="" width={16} height={16} />
                  ) : (
                    c.state === "suggested" && <Image src="/plan/suggested.svg" alt="" width={16} height={16} />
                  )}
                  {c.code}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------- page

function BoardCanvas({
  board,
  selectedId,
  onSelect,
}: {
  board: Board;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const linked = board.edges.filter((e) => e.source === selectedId || e.target === selectedId);
    const related = new Set(linked.flatMap((e) => [e.source, e.target]));

    const nodes: Node[] = [
      ...board.columns.map((column) => ({
        id: column.id,
        type: "term",
        position: { x: column.x, y: 0 },
        width: column.width,
        height: HEADER_H,
        data: { column },
        selectable: false,
      })),
      ...board.columns
        .filter((column) => column.addY !== undefined)
        .map((column) => ({
          id: `add:${column.id}`,
          type: "add",
          position: { x: column.x, y: column.addY! },
          data: {},
          selectable: false,
        })),
      ...board.courses.map((course) => ({
        id: course.id,
        type: "course",
        position: { x: course.x, y: course.y },
        width: NODE_W,
        height: NODE_H,
        data: {
          course,
          selected: course.id === selectedId,
          dimmed: selectedId !== null && course.id !== selectedId && !related.has(course.id),
          onSelect,
        },
      })),
    ];

    // Faint by default. With a course selected, only its own prerequisite and unlock connectors
    // show, solid gold with an arrowhead at the course that needs the other.
    const edges: Edge[] = board.edges.map((e) => {
      const highlighted = e.source === selectedId || e.target === selectedId;
      return {
        ...e,
        type: "lane",
        focusable: false,
        selectable: false,
        hidden: selectedId !== null && !highlighted,
        zIndex: highlighted ? 1 : 0,
        style: highlighted
          ? { stroke: "var(--color-brand-gold)", strokeWidth: 3.5 }
          : { stroke: "var(--color-line-default)", strokeWidth: 1.5, opacity: 0.5 },
        markerEnd: highlighted
          ? {
              type: MarkerType.ArrowClosed,
              color: "var(--color-brand-gold)",
              markerUnits: "userSpaceOnUse",
              width: 18,
              height: 18,
            }
          : undefined,
      };
    });

    return { nodes, edges };
  }, [board, selectedId, onSelect]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      zoomOnDoubleClick={false}
      minZoom={0.2}
      maxZoom={1.5}
      onInit={(flow) => {
        const pane = document.querySelector<HTMLElement>(".react-flow");
        if (pane) flow.setViewport(openingViewport(board, pane.clientWidth, pane.clientHeight));
      }}
      attributionPosition="bottom-center"
      onPaneClick={() => onSelect(null)}
    >
      <Legend />
      <ZoomControl />
    </ReactFlow>
  );
}

function Shell({ advisor, left, children }: { advisor: Advisor; left?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex h-dvh min-h-[420px] flex-col bg-surface-canvas text-ink-primary">
      <TopBar
        surface
        tag={
          <>
            <Pill tone="gold">Advisor</Pill>
            <Link
              href="/advisor"
              className="text-label-14 whitespace-pre text-ink-secondary hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary"
            >
              {"‹  Students"}
            </Link>
            {left}
          </>
        }
      >
        <Button variant="secondary" size="sm" full={false} disabled className="max-lg:hidden">
          Generate draft plan
        </Button>
        <Button size="sm" full={false} disabled className="max-lg:hidden">
          Approve plan
        </Button>
        <Avatar name={advisor.name} size="md" />
      </TopBar>
      <div className="flex min-h-0 flex-1">{children}</div>
    </main>
  );
}

export function PlanCanvas({ planId, advisor }: { planId: string; advisor: Advisor }) {
  const validId = /^[1-9]\d*$/.test(planId);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    (async () => {
      try {
        const plan = await getJson<PlanResponse>(`/api/plans/${planId}`);
        const [student, edges] = await Promise.all([
          getJson<StudentResponse>(`/api/students/${plan.plan.studentId}`),
          getJson<{ prerequisites: Prerequisite[] }>(`/api/plans/${planId}/prerequisites`),
        ]);
        if (!cancelled) setLoad({ status: "ready", plan, student, prerequisites: edges.prerequisites });
      } catch (e) {
        if (cancelled) return;
        setLoad(
          e instanceof FetchError && e.status === 404 ? { status: "missing" } : { status: "error", reason: reasonOf(e) },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, validId, attempt]);

  const board = useMemo(
    () => (load.status === "ready" ? buildBoard(load.plan, load.student, load.prerequisites) : null),
    [load],
  );

  if (!validId || load.status === "missing") {
    return (
      <Shell advisor={advisor}>
        <StateMessage
          kind="empty"
          className="m-auto max-w-[440px]"
          action={
            <ButtonLink href="/advisor" variant="secondary" full={false}>
              Back to your students
            </ButtonLink>
          }
        >
          We couldn&rsquo;t find plan {planId}. It may have been removed, or the link is wrong.
        </StateMessage>
      </Shell>
    );
  }

  if (load.status === "error") {
    return (
      <Shell advisor={advisor}>
        <StateMessage
          kind="error"
          className="m-auto max-w-[440px]"
          action={
            <Button
              full={false}
              onClick={() => {
                setLoad({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          We couldn&rsquo;t load this plan because {load.reason}.
        </StateMessage>
      </Shell>
    );
  }

  if (load.status === "loading" || !board) {
    return (
      <Shell advisor={advisor}>
        <div aria-busy="true" className="flex flex-1 gap-14 overflow-hidden px-7 pt-9 motion-safe:animate-pulse">
          <span className="sr-only" role="status">
            Loading plan…
          </span>
          {[3, 4, 3, 4].map((rows, column) => (
            <div key={column} className="flex flex-none flex-col gap-[45px]">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 rounded-md" width={110} />
                <Skeleton className="h-3 rounded-md" width={90} />
              </div>
              {Array.from({ length: rows }, (_, row) => (
                <Skeleton key={row} className="h-[108px] rounded-card" width={NODE_W} />
              ))}
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  const { plan, student, prerequisites } = load;
  const selected = board.courses.find((c) => c.id === selectedId) ?? null;

  return (
    <Shell
      advisor={advisor}
      left={
        <>
          <span className="h-7 w-[1.5px] flex-none bg-border-subtle" />
          <span className="flex min-w-0 items-center gap-[10px]">
            <Avatar name={plan.plan.studentName} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label-16 text-ink-primary">{plan.plan.studentName}</span>
              <span className="truncate text-caption-12-regular text-ink-secondary">
                {[plan.plan.programName, student.student.expected_graduation].filter(Boolean).join(" · ")}
              </span>
            </span>
          </span>
          <PlanStatusChip status={plan.plan.status} />
        </>
      }
    >
      <div className="relative min-w-0 flex-1">
        <BoardCanvas board={board} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <PlanPanel plan={plan} board={board} prerequisites={prerequisites} selected={selected} onSelect={setSelectedId} />
    </Shell>
  );
}
