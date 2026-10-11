"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
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
import { Pill } from "@/components/Chip";
import { CourseNode, type CourseState } from "@/components/CourseNode";
import {
  BADGE_ICON,
  STATE_ICON,
  codesIn,
  COL_GAP,
  ROW_GAP,
  HEADER_H,
  NODE_H,
  NODE_W,
  type Board,
  type BoardColumn,
  type BoardCourse,
  type BoardGroup,
} from "./board";

const DARK_PILL =
  "flex items-center gap-1.5 rounded-pill bg-ink-primary py-1.5 pl-[10px] pr-3 text-caption-12 whitespace-nowrap text-surface-card";

// ---------------------------------------------------------------- nodes

type CourseData = {
  course: BoardCourse;
  selected: boolean;
  dimmed: boolean;
  draggable: boolean;
  dragging: boolean;
  blocking: boolean; // this course is what the dragged, locked course is waiting on
  tooltip: string | null; // shown under the note while it is being dragged
  error: string | null; // why the last change to this note was refused
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: "none" } as const;

function CourseFlowNode({ data }: NodeProps<Node<CourseData>>) {
  const { course, selected, dimmed, draggable, dragging, blocking, tooltip, error, onSelect, onHover } = data;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(course.id)}
      onMouseEnter={() => onHover(course.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(course.id)}
      onBlur={() => onHover(null)}
      // React Flow turns pointer events off on nodes that are not draggable; the note itself must
      // stay clickable and hoverable either way.
      className={`pointer-events-auto relative block rounded-card text-left transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-primary ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${dimmed ? "opacity-50" : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      {/* While dragged, the note lifts: a slight tilt and the heavier "dragging" shadow. */}
      <div className={`rounded-card transition-transform ${dragging ? "-rotate-3 shadow-dragging" : ""}`}>
        <CourseNode
          code={course.code}
          title={course.title}
          credits={`${course.credits} cr`}
          state={course.state}
          status={course.status}
          blocked={course.blocked}
          grade={course.grade}
          selected={selected && !dragging}
        />
      </div>
      {course.badge && !dragging && (
        <span className="pointer-events-none absolute -inset-[3px] rounded-[18px] border-[2.5px] border-ink-primary" />
      )}
      {course.criticalPath && !dragging && !blocking && (
        <span className="absolute -top-[11px] left-2">
          <Pill tone="gold">Critical path</Pill>
        </span>
      )}
      {blocking && (
        <>
          <span className="pointer-events-none absolute -inset-2 rounded-[22px] border-4 border-brand-gold" />
          <span className={`${DARK_PILL} absolute -top-[22px] left-1/2 -translate-x-1/2`}>
            <Image src="/plan/lock-light.svg" alt="" width={16} height={16} />
            Blocking course
          </span>
        </>
      )}
      {error ? (
        <span
          role="alert"
          className="absolute left-0 top-full mt-2 flex w-[208px] items-start gap-1.5 rounded-[10px] bg-ink-primary px-[10px] py-1.5 text-caption-12 text-surface-card shadow-note-lifted"
        >
          <Image src="/advisor/risk-high.svg" alt="" width={16} height={16} className="flex-none" />
          <span>{error}</span>
        </span>
      ) : (
        course.badge &&
        !dragging && (
          <span className="absolute -bottom-[14px] left-2 flex max-w-[196px] items-center gap-[5px] rounded-pill bg-ink-primary py-[3px] pl-[7px] pr-[10px] text-caption-12 text-surface-card">
            <Image src={BADGE_ICON[course.badge.kind]} alt="" width={16} height={16} className="flex-none" />
            <span className="truncate">{course.badge.text}</span>
          </span>
        )
      )}
      {dragging && tooltip && (
        <span
          role="tooltip"
          className="absolute left-6 top-full mt-3 flex items-center gap-1.5 rounded-[10px] bg-ink-primary py-1.5 pl-[10px] pr-3 text-label-14 whitespace-nowrap text-surface-card shadow-note-lifted"
        >
          <Image src="/plan/tooltip-caret.svg" alt="" width={12} height={6} className="absolute -top-[6px] left-5" />
          <Image src="/plan/lock-light.svg" alt="" width={16} height={16} />
          {tooltip}
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </button>
  );
}

// Dashed placeholder left where a dragged note came from.
function GhostFlowNode({ data }: NodeProps<Node<{ code: string }>>) {
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className="flex items-center justify-center rounded-card border-2 border-dashed border-border-default bg-surface-sunken text-label-14 text-ink-muted"
    >
      {data.code}
    </div>
  );
}

function TermFlowNode({ data }: NodeProps<Node<{ column: BoardColumn }>>) {
  const { column } = data;
  return (
    <div className="flex flex-col gap-0.5 pl-1" style={{ width: column.width }}>
      <div className="flex h-6 items-center gap-2">
        <h2 className="text-title-18 whitespace-nowrap text-ink-primary">{column.title}</h2>
        {column.now && <Pill tone="gold">Now</Pill>}
        {column.where === "plan" && (
          <span className="rounded-pill border-[1.5px] border-ink-on-gold bg-brand-gold px-2 py-px text-caption-12 text-ink-on-gold">
            Plan
          </span>
        )}
      </div>
      <p className="text-caption-12-regular whitespace-nowrap text-ink-muted">{column.sub}</p>
    </div>
  );
}

// Full-height band behind a term. Terms alternate between a faint tint and none, the plan's term
// is faint gold, and "Not yet planned" is one wide dashed region.
const BAND = {
  plain: "",
  tint: "bg-surface-sunken/60",
  plan: "border border-brand-gold/40 bg-brand-gold-soft/45",
  unplanned: "border-[1.5px] border-dashed border-border-default bg-surface-sunken/45",
};

// While a note is dragged, the band it can go to becomes a drop zone. The state is carried by the
// border, an icon and a label, not by colour alone.
const ZONE = {
  valid: {
    box: "border-[2.5px] border-brand-gold bg-brand-gold-soft",
    label: "bg-brand-gold text-ink-primary",
    icon: "/plan/check-dark.svg",
  },
  invalid: {
    box: "border-[2.5px] border-ink-primary bg-surface-sunken",
    label: "bg-ink-primary text-surface-card",
    icon: "/plan/blocked.svg",
  },
};

type BandData = {
  look: keyof typeof BAND;
  width: number;
  height: number;
  // `wide`: a region of several columns, where the label sits beside the header instead of centred
  zone: { kind: keyof typeof ZONE; text: string; over: boolean; labelTop: number; wide: boolean } | null;
};

function BandFlowNode({ data }: NodeProps<Node<BandData>>) {
  const { zone } = data;
  return (
    <div
      className={`relative rounded-panel transition-colors ${zone ? ZONE[zone.kind].box : BAND[data.look]} ${
        zone?.over ? "shadow-note-lifted" : ""
      }`}
      style={{ width: data.width, height: data.height }}
    >
      {zone && (
        <span style={{ top: zone.labelTop }} className={`absolute inset-x-0 flex ${zone.wide ? "justify-start pl-[190px]" : "justify-center"}`}>
          <span
            className={`flex items-center gap-1.5 rounded-pill py-1.5 pl-[10px] pr-[14px] text-caption-12 whitespace-nowrap ${ZONE[zone.kind].label}`}
          >
            <Image src={ZONE[zone.kind].icon} alt="" width={16} height={16} />
            {zone.text}
          </span>
        </span>
      )}
    </div>
  );
}

function GroupFlowNode({ data }: NodeProps<Node<{ group: BoardGroup }>>) {
  const { group } = data;
  return (
    <h3 className="flex items-center gap-1.5 pl-1 text-overline-12 uppercase whitespace-nowrap text-ink-secondary">
      <Image src={STATE_ICON[group.state]} alt="" width={16} height={16} />
      {group.label} · {group.count}
    </h3>
  );
}

function AddFlowNode({ data }: NodeProps<Node<{ disabled: boolean; onAdd: () => void }>>) {
  return (
    <button
      type="button"
      disabled={data.disabled}
      onClick={data.onAdd}
      style={{ width: NODE_W }}
      className="pointer-events-auto cursor-pointer rounded-field border-[1.5px] border-dashed border-ink-muted bg-surface-card/60 py-2 text-caption-12 whitespace-pre text-ink-secondary hover:border-ink-primary hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {"+  Add course"}
    </button>
  );
}

const NODE_TYPES = {
  course: CourseFlowNode,
  ghost: GhostFlowNode,
  term: TermFlowNode,
  add: AddFlowNode,
  band: BandFlowNode,
  heading: GroupFlowNode,
};

// How far a band reaches beyond its column: half the gap to each side, a little above and below.
const BAND_PAD = { x: COL_GAP / 2 - 6, top: 16, bottom: 24 };

// ---------------------------------------------------------------- connectors

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

// ---------------------------------------------------------------- overlays

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

const OVERLAY =
  "flex items-center rounded-card border border-border-subtle bg-surface-card px-4 py-[10px] shadow-note";

function Legend({ dragging }: { dragging: boolean }) {
  const entries: [CourseState, string][] = [
    ["taken", "Taken"],
    ["in-progress", "In progress"],
    ["available", "Available now"],
    ["locked", "Locked"],
    ["suggested", "Suggested"],
  ];
  return (
    <Panel position="bottom-left" style={{ margin: 24, maxWidth: "calc(100% - 210px)" }}>
      <ul className={`${OVERLAY} flex-wrap gap-x-[18px] gap-y-2`}>
        {entries.map(([state, label]) => (
          <li key={state} className="flex items-center gap-1.5 text-caption-12 whitespace-nowrap text-ink-secondary">
            <Image src={STATE_ICON[state]} alt="" width={18} height={18} />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-caption-12 whitespace-nowrap text-ink-secondary max-xl:hidden">
          <span className="h-[3.5px] w-6 rounded-pill bg-brand-gold" />
          {dragging ? "Connected to dragged course" : "Prerequisite, on hover or select"}
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

// ---------------------------------------------------------------- canvas

type Drag = { id: string; x: number; y: number };

type Zone = { kind: keyof typeof ZONE; text: string; missing: string[] };

// What dropping `dragged` on `column` would do, or null if that column is not a target for it.
// A course in the plan can move to another plan term or leave the plan. A course that is not
// planned yet can go into any plan term whose prerequisites it meets.
function dropZone(dragged: BoardCourse, column: BoardColumn): Zone | null {
  if (dragged.drag === "plan") {
    if (column.where === "unplanned") return { kind: "valid", text: "Drop to take out of the plan", missing: [] };
    if (column.where === "plan" && column.termCode !== dragged.termCode) {
      return { kind: "valid", text: `Drop to move to ${column.title}`, missing: [] };
    }
    return null;
  }
  if (dragged.drag === "unplanned" && column.where === "plan" && column.termCode) {
    const fit = dragged.fit[column.termCode];
    return fit && !fit.met
      ? { kind: "invalid", text: "Can’t move here yet", missing: fit.missing }
      : { kind: "valid", text: `Drop to add to ${column.title}`, missing: [] };
  }
  return null;
}

export function BoardCanvas({
  board,
  selectedId,
  onSelect,
  locked,
  noteErrors,
  onAdd,
  onDrop,
}: {
  board: Board;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  locked: boolean; // nothing can be dragged or added: a request is in flight, or the plan is read-only
  noteErrors: Record<string, string>;
  onAdd: (termCode: string) => void;
  // `missing` is empty for a drop the board allows; otherwise it is what the course still needs.
  onDrop: (course: BoardCourse, column: BoardColumn, missing: string[]) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const dragged = drag ? (board.courses.find((c) => c.id === drag.id) ?? null) : null;

  const columnUnder = (position: { x: number; y: number }) => {
    const cx = position.x + NODE_W / 2;
    const cy = position.y + NODE_H / 2;
    if (cy < -BAND_PAD.top || cy > board.bottom + BAND_PAD.bottom) return null;
    return board.columns.find((c) => cx >= c.x - BAND_PAD.x && cx <= c.x + c.width + BAND_PAD.x) ?? null;
  };

  const nodes = useMemo(() => {
    const linked = board.edges.filter((e) => e.source === selectedId || e.target === selectedId);
    const related = new Set(linked.flatMap((e) => [e.source, e.target]));
    const backdrop = { selectable: false, focusable: false, draggable: false, style: { pointerEvents: "none" as const } };

    const zones = new Map<string, Zone>();
    if (dragged) {
      for (const column of board.columns) {
        const zone = dropZone(dragged, column);
        if (zone) zones.set(column.id, zone);
      }
    }
    const over = drag ? columnUnder(drag) : null;
    // The refusal to explain while dragging: the band under the note, or failing that the first
    // band that would refuse it. Its missing courses are the "blocking" ones.
    const refusing =
      (over && zones.get(over.id)?.kind === "invalid" ? zones.get(over.id) : null) ??
      (over && zones.has(over.id) ? null : [...zones.values()].find((z) => z.kind === "invalid")) ??
      null;
    const blocking = new Set<string>();
    for (const code of refusing ? codesIn(refusing.missing) : []) {
      const note = board.courses.filter((c) => c.code === code).at(-1);
      if (note) blocking.add(note.id);
    }

    let terms = 0;
    const nodes: Node[] = [
      ...board.columns.map((column) => {
        const zone = zones.get(column.id);
        return {
          ...backdrop,
          id: `band:${column.id}`,
          type: "band",
          zIndex: -1,
          position: { x: column.x - BAND_PAD.x, y: -BAND_PAD.top },
          data: {
            look: column.where === "term" ? (terms++ % 2 === 0 ? "tint" : "plain") : column.where,
            width: column.width + BAND_PAD.x * 2,
            height: board.bottom + BAND_PAD.top + BAND_PAD.bottom,
            zone: zone
              ? {
                  kind: zone.kind,
                  text: zone.text,
                  over: over?.id === column.id,
                  // Just under the last note of a single column, or in the header row of a wide region.
                  labelTop: column.addY !== undefined ? column.addY + BAND_PAD.top + 52 : BAND_PAD.top + 4,
                  wide: column.addY === undefined,
                }
              : null,
          },
        };
      }),
      ...board.columns.map((column) => ({
        ...backdrop,
        id: column.id,
        type: "term",
        position: { x: column.x, y: 0 },
        width: column.width,
        height: HEADER_H,
        data: { column },
      })),
      ...board.columns.flatMap((column) =>
        (column.groups ?? []).map((group) => ({
          ...backdrop,
          id: `group:${group.state}`,
          // Not "group": React Flow reserves that type name and draws a box around it.
          type: "heading",
          position: { x: group.x, y: HEADER_H + 8 },
          data: { group },
        })),
      ),
      ...board.columns
        .filter((column) => column.addY !== undefined && column.termCode !== null)
        .map((column) => ({
          id: `add:${column.id}`,
          type: "add",
          position: { x: column.x, y: column.addY! },
          data: { disabled: locked, onAdd: () => onAdd(column.termCode!) },
          selectable: false,
          draggable: false,
        })),
      ...(dragged
        ? [{ ...backdrop, id: "ghost", type: "ghost", position: { x: dragged.x, y: dragged.y }, data: { code: dragged.code } }]
        : []),
      ...board.courses.map((course) => {
        const dragging = drag?.id === course.id;
        const draggable = !locked && course.drag !== null;
        return {
          id: course.id,
          type: "course",
          position: dragging ? { x: drag.x, y: drag.y } : { x: course.x, y: course.y },
          width: NODE_W,
          height: NODE_H,
          draggable,
          zIndex: dragging ? 1000 : noteErrors[course.id] ? 10 : 0,
          // Notes glide to their place when they snap back or the board is refreshed.
          className: dragging ? "" : "transition-transform duration-200 ease-out",
          data: {
            course,
            selected: course.id === selectedId,
            dimmed: !drag && selectedId !== null && course.id !== selectedId && !related.has(course.id),
            draggable,
            dragging,
            blocking: blocking.has(course.id),
            tooltip: dragging && refusing ? `Needs ${refusing.missing.join(" and ")} first` : null,
            error: dragging ? null : (noteErrors[course.id] ?? null),
            onSelect,
            onHover: setHoveredId,
          },
        };
      }),
    ];
    return nodes;
    // columnUnder only reads `board`, which is listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selectedId, onSelect, drag, dragged, locked, noteErrors, onAdd]);

  // Connectors stay hidden until a course is hovered, focused, selected or dragged. Then that
  // course's prerequisite and unlock connectors show in gold, with an arrowhead at the course
  // that needs the other.
  const edges = useMemo(
    (): Edge[] =>
      board.edges.map((e) => ({
        ...e,
        type: "lane",
        focusable: false,
        selectable: false,
        hidden: drag
          ? ![e.source, e.target].includes(drag.id)
          : ![e.source, e.target].some((id) => id === selectedId || id === hoveredId),
        zIndex: 1,
        style: { stroke: "var(--color-brand-gold)", strokeWidth: 3.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-brand-gold)",
          markerUnits: "userSpaceOnUse",
          width: 18,
          height: 18,
        },
      })),
    [board, selectedId, hoveredId, drag],
  );

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
      onNodeDragStart={(_, node) => setDrag({ id: node.id, x: node.position.x, y: node.position.y })}
      onNodeDrag={(_, node) => setDrag({ id: node.id, x: node.position.x, y: node.position.y })}
      onNodeDragStop={(_, node) => {
        setDrag(null);
        // Any drop that is not on one of the note's own target bands just snaps back.
        const column = dragged ? columnUnder(node.position) : null;
        const zone = dragged && column ? dropZone(dragged, column) : null;
        if (dragged && column && zone) onDrop(dragged, column, zone.missing);
      }}
      attributionPosition="bottom-center"
      onPaneClick={() => onSelect(null)}
    >
      <Legend dragging={drag !== null} />
      <ZoomControl />
    </ReactFlow>
  );
}
