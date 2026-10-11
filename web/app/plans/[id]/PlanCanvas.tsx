"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink } from "@/components/Button";
import { Avatar, Pill, PlanStatusChip } from "@/components/Chip";
import { Skeleton, StateMessage } from "@/components/State";
import { reasonOf } from "@/lib/fetchJson";
import {
  addCourse,
  checkCourse,
  explain,
  generatePlan,
  isMissing,
  loadBoard,
  removeCourse,
  swapCourse,
  type Alternative,
  type PlanBoardData,
} from "@/lib/planApi";
import type { Advisor } from "@/lib/useAdvisorSession";
import { BoardCanvas } from "./BoardCanvas";
import { CoursePicker, FailedBanner, GenerateDialog, GeneratingBanner, RemoveDialog, Toast, type PickerCourse } from "./Dialogs";
import { PlanPanel, PlanPanelSkeleton, type EditError } from "./PlanPanel";
import { buildBoard, unlockedBy, NODE_W, type BoardCourse } from "./board";

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; reason: string }
  | { status: "ready"; data: PlanBoardData };

type Dialog = null | { kind: "generate" } | { kind: "picker" } | { kind: "remove"; course: BoardCourse };

type Generation = { status: "idle" } | { status: "running" } | { status: "failed"; message: string };

// What a locked course is waiting on, from the API's own check.
type Need = { text: string; sentence: string; codes: string[] };

const COURSE_CODE = /[A-Z]{2,4} [A-Z0-9]{3,5}/g;
const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Shell({
  advisor,
  left,
  generate,
  children,
}: {
  advisor: Advisor;
  left?: React.ReactNode;
  generate?: { label: string; disabled: boolean; onClick: () => void };
  children: React.ReactNode;
}) {
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
        <Button
          variant="secondary"
          size="sm"
          full={false}
          disabled={!generate || generate.disabled}
          onClick={generate?.onClick}
          className="max-lg:hidden"
        >
          {generate?.label ?? "Generate draft plan"}
        </Button>
        {/* Approval and overrides come in the next pass. */}
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
  const router = useRouter();
  const validId = /^[1-9]\d*$/.test(planId);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Editing state. `busy` is true while any request that changes the plan is in flight.
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editError, setEditError] = useState<EditError | null>(null);
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [pickerError, setPickerError] = useState<{ courseId: number; message: string } | null>(null);
  const [pickerBusyId, setPickerBusyId] = useState<number | null>(null);
  const [generation, setGeneration] = useState<Generation>({ status: "idle" });
  const [needs, setNeeds] = useState<Map<number, Need>>(new Map());

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await loadBoard(planId);
        if (!cancelled) setLoad({ status: "ready", data });
      } catch (e) {
        if (!cancelled) setLoad(isMissing(e) ? { status: "missing" } : { status: "error", reason: reasonOf(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, validId, attempt]);

  // Ask the API why each locked course is locked. That depends on the student's transcript, not on
  // the plan, so it is fetched once and reused for notes, drag tooltips and the course picker.
  const lockedKey =
    load.status === "ready"
      ? load.data.student.remaining
          .filter((r) => !r.eligible)
          .map((r) => r.course_id)
          .join(",")
      : "";
  useEffect(() => {
    if (!lockedKey) return;
    let cancelled = false;
    (async () => {
      const checks = await Promise.all(
        lockedKey.split(",").map(async (id) => {
          try {
            return [Number(id), await checkCourse(Number(planId), Number(id))] as const;
          } catch {
            return null; // the note just says "Locked"
          }
        }),
      );
      if (cancelled) return;
      const found = new Map<number, Need>();
      for (const entry of checks) {
        if (!entry || entry[1].missing.length === 0) continue;
        const what = entry[1].missing.join(" and ");
        const issue = entry[1].problems.find((p) => p.type === "not_eligible");
        found.set(entry[0], {
          text: `Needs ${what}`,
          sentence: issue?.message ?? `It needs ${what} first.`,
          codes: what.match(COURSE_CODE) ?? [],
        });
      }
      setNeeds(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [lockedKey, planId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const board = useMemo(() => {
    if (load.status !== "ready") return null;
    const labels = new Map([...needs].map(([id, need]) => [id, need.text]));
    return buildBoard(load.data.plan, load.data.student, load.data.prerequisites, labels);
  }, [load, needs]);

  const blockers = useCallback((course: BoardCourse) => needs.get(course.courseId ?? -1)?.codes ?? [], [needs]);
  const openPicker = useCallback(() => {
    setPickerError(null);
    setDialog({ kind: "picker" });
  }, []);

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

  const { plan, student, prerequisites } = load.data;
  const numericId = plan.plan.id;
  const termName = plan.term.name;
  const firstName = plan.plan.studentName.trim().split(/\s+/)[0];
  const selected = board.courses.find((c) => c.id === selectedId) ?? null;
  const generating = generation.status === "running";

  // ---- changing the plan

  // Runs one change, then reloads the board from the API so totals and the summary are current.
  // Returns the plain-language reason if the API refused the change, or null if it went through.
  async function change(action: () => Promise<unknown>): Promise<string | null> {
    setBusy(true);
    setEditError(null);
    setNoteErrors({});
    try {
      await action();
    } catch (e) {
      setBusy(false);
      return explain(e);
    }
    try {
      setLoad({ status: "ready", data: await loadBoard(numericId) });
    } catch (e) {
      // The change was saved but the board could not be re-read: show the load error with a retry.
      setLoad({ status: "error", reason: reasonOf(e) });
    }
    setBusy(false);
    return null;
  }

  function refused(course: BoardCourse, title: string, message: string) {
    setNoteErrors({ [course.id]: message });
    setEditError({ title, message });
  }

  async function addFromBoard(course: BoardCourse) {
    if (course.courseId === null) return;
    const reason = await change(() => addCourse(numericId, course.courseId!, advisor.id));
    if (reason) return refused(course, `Can’t add ${course.code} to ${termName}`, reason);
    setToast(`${course.code} added to ${termName}`);
    setSelectedId(`plan:${course.code}`);
  }

  async function addFromPicker(course: PickerCourse) {
    setPickerError(null);
    setPickerBusyId(course.courseId);
    const reason = await change(() => addCourse(numericId, course.courseId, advisor.id));
    setPickerBusyId(null);
    if (reason) return setPickerError({ courseId: course.courseId, message: reason });
    setDialog(null);
    setToast(`${course.code} added to ${termName}`);
    setSelectedId(`plan:${course.code}`);
  }

  function dropLocked(course: BoardCourse) {
    const need = needs.get(course.courseId ?? -1);
    refused(
      course,
      `Can’t add ${course.code} to ${termName} yet`,
      need?.sentence ?? `${course.code} has prerequisites that are not finished yet.`,
    );
  }

  async function confirmRemove(course: BoardCourse) {
    if (!course.item) return;
    const reason = await change(() => removeCourse(numericId, course.item!.id, advisor.id));
    setDialog(null);
    if (reason) return refused(course, `Can’t remove ${course.code}`, reason);
    setToast(`${course.code} removed from ${termName}`);
    if (selectedId === course.id) setSelectedId(null);
  }

  async function swap(course: BoardCourse, alternative: Alternative) {
    if (!course.item) return;
    const reason = await change(() => swapCourse(numericId, course.item!.id, alternative.courseId, advisor.id));
    if (reason) return refused(course, `Can’t swap ${course.code} for ${alternative.code}`, reason);
    setToast(`${alternative.code} swapped in for ${course.code}`);
    setSelectedId(`plan:${alternative.code}`);
  }

  async function generate() {
    setDialog(null);
    setBusy(true);
    setEditError(null);
    setNoteErrors({});
    setGeneration({ status: "running" });
    try {
      const created = await generatePlan(plan.plan.studentId, advisor.id);
      // A new draft is a new plan with its own id. `busy` stays on until that page takes over.
      router.replace(`/plans/${created.plan.id}${window.location.search}`);
    } catch (e) {
      const reason = explain(e);
      const unsure = reason.includes("too long") || reason.includes("connection");
      setGeneration({
        status: "failed",
        message: unsure
          ? `${reason} The planner may still finish, so reload in a moment to check.`
          : `${reason} Nothing on the board changed.`,
      });
      setBusy(false);
    }
  }

  // ---- derived for the dialogs

  const plannedIds = new Set(plan.items.map((item) => item.courseId));
  const rank = { eligible: 0, locked: 1, planned: 2 };
  const pickerCourses: PickerCourse[] = student.remaining
    .map((r) => ({
      courseId: r.course_id,
      code: r.code,
      title: r.title,
      group: humanize(r.group_label ?? r.category ?? "Other"),
      pick: r.pick_count,
      state: plannedIds.has(r.course_id) ? ("planned" as const) : r.eligible ? ("eligible" as const) : ("locked" as const),
      needs: needs.get(r.course_id)?.text ?? null,
    }))
    .sort((a, b) => rank[a.state] - rank[b.state]);

  const affectedBy = (course: BoardCourse) => {
    const dependents = new Set(unlockedBy(course.code, prerequisites));
    return plan.items.filter((item) => dependents.has(item.code)).map((item) => ({ code: item.code, title: item.title }));
  };

  return (
    <Shell
      advisor={advisor}
      generate={{
        label: generating ? "Generating…" : "Generate draft plan",
        disabled: busy,
        onClick: () => setDialog({ kind: "generate" }),
      }}
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
      <div className="relative min-w-0 flex-1" aria-busy={busy}>
        <BoardCanvas
          board={board}
          planTerm={termName}
          selectedId={selectedId}
          onSelect={setSelectedId}
          locked={busy}
          noteErrors={noteErrors}
          blockers={blockers}
          onAdd={openPicker}
          onDropAdd={addFromBoard}
          onDropRemove={(course) => setDialog({ kind: "remove", course })}
          onDropLocked={dropLocked}
        />
        {generating ? (
          <GeneratingBanner />
        ) : generation.status === "failed" ? (
          <FailedBanner
            message={generation.message}
            onRetry={generate}
            onDismiss={() => setGeneration({ status: "idle" })}
          />
        ) : (
          toast && <Toast message={toast} />
        )}
      </div>

      {generating ? (
        <PlanPanelSkeleton />
      ) : (
        <PlanPanel
          plan={plan}
          board={board}
          prerequisites={prerequisites}
          selected={selected}
          busy={busy}
          editError={editError}
          onDismissError={() => {
            setEditError(null);
            setNoteErrors({});
          }}
          onSelect={setSelectedId}
          onAdd={addFromBoard}
          onSwap={swap}
          onRemove={(course) => setDialog({ kind: "remove", course })}
        />
      )}

      {dialog?.kind === "generate" && (
        <GenerateDialog
          firstName={firstName}
          status={plan.plan.status}
          updatedAt={plan.plan.updatedAt}
          courses={plan.totals.courses}
          termName={termName}
          onKeep={() => setDialog(null)}
          onGenerate={generate}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveDialog
          code={dialog.course.code}
          termName={termName}
          affected={affectedBy(dialog.course)}
          busy={busy}
          onCancel={() => setDialog(null)}
          onRemove={() => confirmRemove(dialog.course)}
        />
      )}
      {dialog?.kind === "picker" && (
        <CoursePicker
          termName={termName}
          courses={pickerCourses}
          busyId={pickerBusyId}
          error={pickerError}
          onAdd={addFromPicker}
          onClose={() => setDialog(null)}
        />
      )}
    </Shell>
  );
}
