"use client";

import { useState } from "react";
import Image from "next/image";
import { Button, TextButton } from "@/components/Button";
import { Pill } from "@/components/Chip";
import { SuggestedTag } from "@/components/CourseNode";
import { Skeleton } from "@/components/State";
import { explain, getAlternatives, type Alternative, type PlanResponse, type Prerequisite, type TermRef } from "@/lib/planApi";
import { BADGE_ICON, STATE_ICON, prerequisiteGroups, unlockedBy, type Board, type BoardCourse } from "./board";

const LABEL = "text-overline-12 uppercase whitespace-nowrap text-ink-secondary";

// `action` is a way forward the API offered, e.g. "Move to Fall 2027".
export type EditError = { title: string; message: string; action?: { label: string; onClick: () => void } };

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
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Alternatives = { status: "closed" } | { status: "loading" } | { status: "error"; reason: string } | { status: "ready"; list: Alternative[] };

function SelectedCourse({
  planId,
  terms,
  course,
  board,
  prerequisites,
  busy,
  canOverride,
  onClose,
  onAdd,
  onMove,
  onConfirm,
  onSwap,
  onRemove,
  onOverride,
}: {
  planId: number;
  terms: TermRef[]; // the plan terms on the board
  course: BoardCourse;
  board: Board;
  prerequisites: Prerequisite[];
  busy: boolean; // a request is in flight, or the plan is read-only
  canOverride: boolean; // this advisor may override a blocking problem
  onClose: () => void;
  onAdd: (course: BoardCourse, term: TermRef) => void;
  onMove: (course: BoardCourse, term: TermRef) => void;
  onConfirm: (course: BoardCourse) => void;
  onSwap: (course: BoardCourse, alternative: Alternative) => void;
  onRemove: (course: BoardCourse) => void;
  onOverride: (course: BoardCourse) => void;
}) {
  const [alternatives, setAlternatives] = useState<Alternatives>({ status: "closed" });
  const groups = prerequisiteGroups(course.code, prerequisites);
  const unlocks = unlockedBy(course.code, prerequisites);
  const { item } = course;
  const section = item?.section;

  async function toggleAlternatives() {
    if (!item) return;
    if (alternatives.status !== "closed") {
      setAlternatives({ status: "closed" });
      return;
    }
    setAlternatives({ status: "loading" });
    try {
      setAlternatives({ status: "ready", list: await getAlternatives(planId, course.courseId) });
    } catch (e) {
      setAlternatives({ status: "error", reason: explain(e) });
    }
  }

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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close course details"
          className="flex-none cursor-pointer rounded-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary"
        >
          <Image src="/advisor/close.svg" alt="" width={28} height={28} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="text-body-14 text-ink-primary">
          {course.title} · {course.termLabel} · {course.credits} cr
        </p>
        {course.fills && <p className="text-caption-12-regular text-ink-secondary">Fills: {course.fills}</p>}
      </div>

      {item && (
        <div className="flex flex-wrap gap-2">
          {item.suggested && (
            <Button variant="gold" size="sm" full={false} disabled={busy} onClick={() => onConfirm(course)}>
              Confirm
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            full={false}
            disabled={busy}
            aria-expanded={alternatives.status !== "closed"}
            onClick={toggleAlternatives}
          >
            Swap
          </Button>
          <Button variant="secondary" size="sm" full={false} disabled={busy} onClick={() => onRemove(course)}>
            Remove
          </Button>
          {/* The same move as dragging the note to another plan term. */}
          {terms
            .filter((term) => term.code !== course.termCode)
            .map((term) => (
              <Button key={term.code} variant="secondary" size="sm" full={false} disabled={busy} onClick={() => onMove(course, term)}>
                Move to {term.name}
              </Button>
            ))}
        </div>
      )}

      {course.where === "unplanned" && (
        <div className="flex flex-wrap gap-2">
          {/* The same add as dragging the note into a plan term; offered where the prerequisites are met. */}
          {terms
            .filter((term) => course.fit[term.code]?.met)
            .map((term, i) => (
              <Button
                key={term.code}
                variant={i === 0 ? "gold" : "secondary"}
                size="sm"
                full={false}
                disabled={busy}
                onClick={() => onAdd(course, term)}
              >
                Add to {term.name}
              </Button>
            ))}
        </div>
      )}

      {alternatives.status !== "closed" && (
        <div className="flex flex-col gap-0.5">
          <h3 className={LABEL}>Alternatives</h3>
          {alternatives.status === "loading" ? (
            <p className="border-t border-border-subtle py-[7px] text-body-14 text-ink-secondary">Loading alternatives…</p>
          ) : alternatives.status === "error" ? (
            <p role="alert" className="border-t border-border-subtle py-[7px] text-body-14 text-ink-primary">
              Couldn&rsquo;t load alternatives. {alternatives.reason}
            </p>
          ) : alternatives.list.length === 0 ? (
            <p className="border-t border-border-subtle py-[7px] text-body-14 text-ink-secondary">
              There is nothing else this student can take in {course.termLabel}.
            </p>
          ) : (
            <ul className="max-h-[228px] overflow-y-auto">
              {alternatives.list.map((alternative) => (
                <li key={alternative.courseId} className="flex items-center gap-2 border-t border-border-subtle py-[7px]">
                  <span className="flex-none text-label-14 text-ink-primary">{alternative.code}</span>
                  <span className="min-w-0 flex-1 truncate text-body-14 text-ink-secondary">{alternative.title}</span>
                  <TextButton
                    className="flex-none text-caption-12 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy}
                    aria-label={`Swap in ${alternative.code}`}
                    onClick={() => onSwap(course, alternative)}
                  >
                    Swap in
                  </TextButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {item?.reason && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Why this course</h3>
          <p className="text-body-14 text-ink-primary">{item.reason}</p>
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

      {item && item.issues.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Issues</h3>
          <ul className="flex flex-col gap-1 text-body-14 text-ink-primary">
            {item.issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          {item.override ? (
            <p className="text-caption-12-regular text-ink-secondary">
              Overridden{item.override.advisorName ? ` by ${item.override.advisorName}` : ""} on {day(item.override.at)}:{" "}
              {item.override.note}
            </p>
          ) : (
            canOverride &&
            item.issues.some((issue) => issue.severity === "high" && !issue.overridden) && (
              <Button variant="secondary" size="sm" full={false} disabled={busy} className="mt-1 self-start" onClick={() => onOverride(course)}>
                Override
              </Button>
            )
          )}
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

const PANEL =
  "my-3 mr-4 flex w-[368px] flex-none flex-col gap-[22px] overflow-y-auto rounded-panel border border-border-subtle bg-surface-card p-5 shadow-panel short:gap-4 short:p-4 max-md:hidden";

// Stand-in for the panel while a new draft is being generated.
export function PlanPanelSkeleton() {
  return (
    <aside aria-label="Plan details" aria-busy="true" className={`${PANEL} overflow-hidden`}>
      <p className="text-body-14 text-ink-secondary">Writing the plan rationale…</p>
      <div className="flex flex-col gap-[22px] motion-safe:animate-pulse">
        <Skeleton className="h-[150px] w-full rounded-card" />
        <Skeleton className="h-3 rounded-md" width={130} />
        {[300, 280, 220, 150].map((width) => (
          <Skeleton key={width} className="h-3 rounded-md" width={width} />
        ))}
        <Skeleton className="h-2.5 w-full rounded-md" />
        <Skeleton className="h-2.5 w-full rounded-md" />
        <Skeleton className="h-3 rounded-md" width={160} />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[26px] rounded-pill" width={84} />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function PlanPanel({
  plan,
  board,
  prerequisites,
  selected,
  busy,
  canOverride,
  terms,
  editError,
  onDismissError,
  onSelect,
  onAdd,
  onMove,
  onConfirm,
  onSwap,
  onRemove,
  onOverride,
  onReopen,
}: {
  plan: PlanResponse;
  board: Board;
  prerequisites: Prerequisite[];
  selected: BoardCourse | null;
  busy: boolean;
  canOverride: boolean;
  terms: TermRef[];
  editError: EditError | null;
  onDismissError: () => void;
  onSelect: (id: string | null) => void;
  onAdd: (course: BoardCourse, term: TermRef) => void;
  onMove: (course: BoardCourse, term: TermRef) => void;
  onConfirm: (course: BoardCourse) => void;
  onSwap: (course: BoardCourse, alternative: Alternative) => void;
  onRemove: (course: BoardCourse) => void;
  onOverride: (course: BoardCourse) => void;
  onReopen: () => void;
}) {
  const { credits, target, courses } = plan.totals;
  const points = plan.plan.rationalePoints ?? [];
  const planned = board.courses.filter((c) => c.where === "plan");

  return (
    <aside aria-label="Plan details" className={PANEL}>
      {plan.readOnly && (
        <div className="flex flex-none flex-col items-start gap-2 rounded-field border border-border-subtle bg-surface-sunken px-3 py-[10px]">
          <p className="text-body-14 text-ink-primary">
            {plan.plan.approvedBy && plan.plan.approvedAt
              ? `Approved by ${plan.plan.approvedBy} on ${day(plan.plan.approvedAt)}.`
              : "This plan is approved."}{" "}
            It is read-only until it is reopened.
          </p>
          <TextButton className="disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} onClick={onReopen}>
            Reopen plan
          </TextButton>
        </div>
      )}
      {editError && (
        <section
          role="alert"
          className="flex flex-none flex-col gap-3 rounded-card border-[1.5px] border-ink-primary bg-surface-canvas px-4 py-[14px]"
        >
          <div className="flex items-center gap-2">
            <Image src="/plan/error.svg" alt="" width={22} height={22} className="flex-none" />
            <h2 className="min-w-0 flex-1 text-label-16 text-ink-primary">{editError.title}</h2>
          </div>
          <p className="text-body-14 text-ink-primary">{editError.message}</p>
          <div className="flex flex-wrap gap-2">
            {editError.action && (
              <Button variant="gold" size="sm" full={false} disabled={busy} onClick={editError.action.onClick}>
                {editError.action.label}
              </Button>
            )}
            <Button variant="secondary" size="sm" full={false} onClick={onDismissError}>
              Dismiss
            </Button>
          </div>
        </section>
      )}

      {selected && (
        <SelectedCourse
          key={selected.id}
          planId={plan.plan.id}
          terms={terms}
          course={selected}
          board={board}
          prerequisites={prerequisites}
          busy={busy || plan.readOnly}
          canOverride={canOverride}
          onClose={() => onSelect(null)}
          onAdd={onAdd}
          onMove={onMove}
          onConfirm={onConfirm}
          onSwap={onSwap}
          onRemove={onRemove}
          onOverride={onOverride}
        />
      )}

      <section className="flex flex-none flex-col gap-[10px]">
        <h2 className={LABEL}>Why this plan</h2>
        {points.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {points.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-body-14 text-ink-primary">
                <span className="mt-[7px] size-1.5 flex-none rounded-pill border-[1.5px] border-brand-gold-deep bg-brand-gold" />
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-14 text-ink-primary">{plan.plan.rationale ?? "No rationale was recorded for this plan."}</p>
        )}
        <p className="text-caption-12-regular text-ink-secondary">
          {plan.plan.createdBy === "ai" ? "Drafted by AI" : "Created by an advisor"}
          {plan.plan.modelName ? ` · ${plan.plan.modelName}` : ""}
        </p>
      </section>

      <section className="flex flex-none flex-col gap-[10px]">
        <h2 className={LABEL}>Credits per term</h2>
        {plan.totals.byTerm.map((term) => (
          <div key={term.code} className="flex items-center gap-[10px]">
            <span className="w-[92px] flex-none text-body-14 text-ink-primary">
              {plan.terms.find((t) => t.code === term.code)?.name ?? term.code}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-clip rounded-pill border border-border-default bg-surface-sunken">
              <span
                className="block h-full bg-ink-primary transition-[width]"
                style={{ width: `${target > 0 ? Math.min(100, (term.credits / target) * 100) : 0}%` }}
              />
            </span>
            <span className="flex-none text-label-14 whitespace-nowrap text-ink-primary">{term.credits} cr</span>
          </div>
        ))}
        <p className="text-caption-12-regular text-ink-secondary">Target: {target} cr per term</p>
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
