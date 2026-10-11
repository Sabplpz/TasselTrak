"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink } from "@/components/Button";
import { Avatar, Pill, PlanStatusChip } from "@/components/Chip";
import { Skeleton, StateMessage } from "@/components/State";
import {
  addCourse,
  approvePlan,
  backToDraft,
  codeOf,
  confirmCourse,
  explain,
  generatePlan,
  getCourseOptions,
  getDependents,
  getPlan,
  getPrerequisites,
  getStudentExtras,
  moveCourse,
  overrideCourse,
  PlanApiError,
  removeCourse,
  reopenPlan,
  restoreCourse,
  submitForReview,
  swapCourse,
  type Alternative,
  type CourseOptions,
  type PlanResponse,
  type Prerequisite,
  type StudentExtras,
  type TermRef,
} from "@/lib/planApi";
import type { Advisor } from "@/lib/useAdvisorSession";
import { BoardCanvas } from "./BoardCanvas";
import {
  ApproveDialog,
  CoursePicker,
  GenerateDialog,
  GeneratingBanner,
  NoticeBanner,
  OverrideDialog,
  RemoveDialog,
  Toast,
  type Dependents,
  type PickerError,
} from "./Dialogs";
import { PlanPanel, PlanPanelSkeleton, type EditError } from "./PlanPanel";
import { buildBoard, planTerms, termAfter, NODE_W, type BoardColumn, type BoardCourse } from "./board";

// Everything the board is built from. `later` is the empty plan term after the last one, shown
// so courses can be moved into it; null when the API does not know that term or the plan is
// read-only.
type BoardData = {
  plan: PlanResponse;
  prerequisites: Prerequisite[];
  options: Record<string, CourseOptions>;
  extras: StudentExtras | null;
  later: TermRef | null;
};

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; reason: string }
  | { status: "ready"; data: BoardData };

// A course as the change handlers need it: enough to call the API and to name it.
type CourseRef = { courseId: number; code: string; nodeId?: string };

type Dialog =
  | null
  | { kind: "generate"; planId: number; status: PlanResponse["plan"]["status"] }
  | { kind: "picker"; term: TermRef }
  | { kind: "remove"; course: BoardCourse }
  // the problems that block approval
  | { kind: "approve" }
  // the written reason for an override. `course` null: every remaining problem, then approve.
  // `from`: where it was opened, and where a single-course override returns to.
  | { kind: "override"; course: CourseRef | null; from: "approve" | "panel" };

type Generation =
  | { status: "idle" }
  | { status: "running" }
  | { status: "failed"; message: string; retry: (() => void) | null };

type ToastState = { message: string; undo?: () => void };

async function loadBoardData(planId: string | number): Promise<BoardData> {
  const plan = await getPlan(planId);
  const last = planTerms(plan, null).at(-1)!;
  const candidate = plan.readOnly ? null : termAfter(last);
  const terms = planTerms(plan, candidate);
  // The plan and its prerequisites are required. The rest only enriches the board, so a failure
  // there leaves that part out instead of failing the page.
  const [prerequisites, extras, ...lists] = await Promise.all([
    getPrerequisites(plan.plan.id),
    getStudentExtras(plan.plan.studentId).catch(() => null),
    ...terms.map((term) => getCourseOptions(plan.plan.id, term.code).catch(() => null)),
  ]);
  const options: Record<string, CourseOptions> = {};
  terms.forEach((term, i) => {
    const list = lists[i];
    if (list) options[term.code] = list;
  });
  const later = candidate && options[candidate.code]?.term.open ? candidate : null;
  return { plan, prerequisites, options, extras, later };
}

function Shell({
  advisor,
  left,
  generate,
  actions,
  children,
}: {
  advisor: Advisor;
  left?: React.ReactNode;
  generate?: { label: string; disabled: boolean; onClick: () => void };
  actions?: React.ReactNode; // the review and approval buttons, once the plan is loaded
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
        {actions ?? (
          <Button size="sm" full={false} disabled className="max-lg:hidden">
            Approve plan
          </Button>
        )}
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
  const [dependents, setDependents] = useState<Dependents>({ status: "loading" });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [editError, setEditError] = useState<EditError | null>(null);
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [pickerError, setPickerError] = useState<PickerError | null>(null);
  const [pickerBusyId, setPickerBusyId] = useState<number | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Generation>({ status: "idle" });
  const generating = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await loadBoardData(planId);
        if (!cancelled) setLoad({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        setLoad(codeOf(e) === "plan_not_found" ? { status: "missing" } : { status: "error", reason: explain(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, validId, attempt]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  const board = useMemo(() => {
    if (load.status !== "ready") return null;
    const { plan, options, prerequisites, extras, later } = load.data;
    return buildBoard(plan, options, prerequisites, extras, later);
  }, [load]);

  const openPicker = useCallback((termCode: string) => {
    setPickerError(null);
    setDialog((current) => current ?? { kind: "picker", term: { code: termCode, name: termCode } });
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
          We couldn&rsquo;t load this plan. {load.reason}
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

  const { plan, prerequisites, options, later } = load.data;
  const numericId = plan.plan.id;
  const terms = planTerms(plan, later);
  const firstName = plan.plan.studentName.trim().split(/\s+/)[0];
  const selected = board.courses.find((c) => c.id === selectedId) ?? null;
  const isGenerating = generation.status === "running";
  const frozen = busy || plan.readOnly;

  // ---- changing the plan

  // Runs one change, then reloads the board from the API so totals and the summary are current.
  // Returns the API's refusal, or null if the change went through.
  async function change(action: () => Promise<unknown>): Promise<PlanApiError | null> {
    setBusy(true);
    setToast(null);
    setEditError(null);
    setNoteErrors({});
    try {
      await action();
    } catch (e) {
      setBusy(false);
      return e instanceof PlanApiError ? e : new PlanApiError("server_error");
    }
    try {
      setLoad({ status: "ready", data: await loadBoardData(numericId) });
    } catch (e) {
      // The change was saved but the board could not be re-read: show the load error with a retry.
      setLoad({ status: "error", reason: explain(e) });
    }
    setBusy(false);
    return null;
  }

  function refused(course: CourseRef, error: EditError) {
    if (course.nodeId) setNoteErrors({ [course.nodeId]: error.message });
    setEditError(error);
  }

  async function add(course: CourseRef, term: TermRef) {
    const error = await change(() => addCourse(numericId, course.courseId, term.code, advisor.id));
    if (error) {
      const next = error.suggestedTerm;
      return refused(course, {
        title: `Can’t add ${course.code} to ${term.name}`,
        message: error.message,
        action: next && next.code !== term.code ? { label: `Add to ${next.name}`, onClick: () => add(course, next) } : undefined,
      });
    }
    setSelectedId(`plan:${course.code}`);
    // Undo after an add is a remove.
    setToast({ message: `${course.code} added to ${term.name}`, undo: () => remove(course, term.name, false) });
  }

  async function addFromPicker(course: CourseRef, term: TermRef) {
    setPickerError(null);
    setPickerBusyId(course.courseId);
    const error = await change(() => addCourse(numericId, course.courseId, term.code, advisor.id));
    setPickerBusyId(null);
    if (error) {
      const next = error.suggestedTerm;
      return setPickerError({
        courseId: course.courseId,
        message: error.message,
        suggestedTerm: next && next.code !== term.code ? next : null,
      });
    }
    setDialog(null);
    setSelectedId(`plan:${course.code}`);
    setToast({ message: `${course.code} added to ${term.name}`, undo: () => remove(course, term.name, false) });
  }

  async function move(course: CourseRef, from: TermRef | null, to: TermRef, undoable = true) {
    const error = await change(() => moveCourse(numericId, course.courseId, to.code, advisor.id));
    if (error) {
      const next = error.suggestedTerm;
      return refused(course, {
        title: `Can’t move ${course.code} to ${to.name}`,
        message: error.message,
        action:
          next && next.code !== to.code && next.code !== from?.code
            ? { label: `Move to ${next.name}`, onClick: () => move(course, from, next) }
            : undefined,
      });
    }
    setToast({
      message: `${course.code} moved to ${to.name}`,
      undo: undoable && from ? () => move(course, to, from, false) : undefined,
    });
  }

  async function remove(course: CourseRef, termName: string, undoable = true) {
    const error = await change(() => removeCourse(numericId, course.courseId, advisor.id));
    setDialog(null);
    if (error) return refused(course, { title: `Can’t remove ${course.code}`, message: error.message });
    if (selectedId === `plan:${course.code}`) setSelectedId(null);
    setToast({ message: `${course.code} removed from ${termName}`, undo: undoable ? () => restore(course) : undefined });
  }

  async function restore(course: CourseRef) {
    const error = await change(() => restoreCourse(numericId, course.courseId, advisor.id));
    if (error) return setEditError({ title: `Can’t bring ${course.code} back`, message: error.message });
    setToast({ message: `${course.code} is back in the plan` });
  }

  async function confirm(course: BoardCourse) {
    const error = await change(() => confirmCourse(numericId, course.courseId, advisor.id));
    if (error) return refused({ ...course, nodeId: course.id }, { title: `Can’t confirm ${course.code}`, message: error.message });
    setToast({ message: `${course.code} confirmed` });
  }

  async function swap(course: BoardCourse, alternative: Alternative) {
    const error = await change(() => swapCourse(numericId, course.courseId, alternative.courseId, advisor.id));
    if (error) {
      return refused(
        { ...course, nodeId: course.id },
        { title: `Can’t swap ${course.code} for ${alternative.code}`, message: error.message },
      );
    }
    setSelectedId(`plan:${alternative.code}`);
    setToast({ message: `${alternative.code} swapped in for ${course.code}` });
  }

  // A note was dropped on one of its target bands. `missing` is what the board already knows the
  // course still needs for that term; when it is not empty nothing is sent.
  function drop(course: BoardCourse, column: BoardColumn, missing: string[]) {
    const ref = { courseId: course.courseId, code: course.code, nodeId: course.id };
    if (missing.length > 0) {
      const fits = terms.find((term) => course.fit[term.code]?.met);
      return refused(ref, {
        title: `Can’t add ${course.code} to ${column.title} yet`,
        message: `${course.code} needs ${missing.join(" and ")} first.`,
        action: fits ? { label: `Add to ${fits.name}`, onClick: () => add(ref, fits) } : undefined,
      });
    }
    if (column.where === "unplanned") return openRemove(course);
    const term = { code: column.termCode!, name: column.title };
    if (course.drag === "unplanned") return void add(ref, term);
    void move(ref, course.termCode ? { code: course.termCode, name: course.termLabel } : null, term);
  }

  function openRemove(course: BoardCourse) {
    setDialog({ kind: "remove", course });
    setDependents({ status: "loading" });
    getDependents(numericId, course.courseId).then(
      (list) => setDependents({ status: "ready", list }),
      () => setDependents({ status: "unknown" }),
    );
  }

  // ---- review and approval

  // Moves the plan between draft, in review and approved.
  async function setStatus(action: () => Promise<unknown>, done: string, failed: string) {
    const error = await change(action);
    if (error) return setEditError({ title: failed, message: error.message });
    setToast({ message: done });
  }

  const reopen = () => setStatus(() => reopenPlan(numericId, advisor.id), "Plan reopened. It can be edited again.", "Can’t reopen this plan");

  async function approve() {
    // The problems are already known from the plan object: show them instead of asking to be refused.
    if (!plan.canApprove) return setDialog({ kind: "approve" });
    const error = await change(() => approvePlan(numericId, advisor.id));
    if (!error) {
      setDialog(null);
      return setToast({ message: `${firstName}’s plan is approved` });
    }
    if (error.code === "blocking_issues") {
      // The plan changed since it was loaded. Read it again; the dialog lists what it has now.
      setAttempt((n) => n + 1);
      return setDialog({ kind: "approve" });
    }
    setDialog(null);
    setEditError({ title: "Can’t approve this plan", message: error.message });
  }

  function openOverride(course: CourseRef | null, from: "approve" | "panel") {
    setOverrideError(null);
    setDialog({ kind: "override", course, from });
  }

  async function override(course: CourseRef | null, from: "approve" | "panel", note: string) {
    setOverrideError(null);
    const error = await change(() =>
      course ? overrideCourse(numericId, course.courseId, advisor.id, note) : approvePlan(numericId, advisor.id, note),
    );
    if (error) return setOverrideError(error.message);
    setDialog(course && from === "approve" ? { kind: "approve" } : null);
    setToast({ message: course ? `Problem with ${course.code} overridden` : `${firstName}’s plan is approved` });
  }

  // ---- generating a draft

  async function generate(replace: boolean) {
    const controller = new AbortController();
    generating.current = controller;
    setDialog(null);
    setBusy(true);
    setToast(null);
    setEditError(null);
    setNoteErrors({});
    setGeneration({ status: "running" });
    try {
      const created = await generatePlan(plan.plan.studentId, advisor.id, replace, controller.signal);
      // A new draft is a new plan with its own id. `busy` stays on until that page takes over.
      router.replace(`/plans/${created.plan.id}${window.location.search}`);
      return;
    } catch (e) {
      const error = e instanceof PlanApiError ? e : new PlanApiError("server_error");
      if (error.code === "plan_exists" && error.existing) {
        setGeneration({ status: "idle" });
        setDialog({ kind: "generate", planId: error.existing.planId, status: error.existing.status });
      } else if (error.code === "cancelled") {
        setGeneration({ status: "idle" });
      } else {
        const retryable = !["plan_approved", "no_candidates", "student_not_found"].includes(error.code);
        const lead = error.code === "plan_approved" ? "" : "Couldn’t generate a draft plan. ";
        setGeneration({ status: "failed", message: `${lead}${error.message}`, retry: retryable ? () => generate(replace) : null });
      }
      setBusy(false);
    }
  }

  const pickerTerm = dialog?.kind === "picker" ? (terms.find((t) => t.code === dialog.term.code) ?? dialog.term) : null;
  const edited = new Date(plan.plan.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const planned = plan.terms.filter((t) => t.state === "planned");
  const overriding = dialog?.kind === "override" ? dialog : null;
  const { status } = plan.plan;

  return (
    <Shell
      advisor={advisor}
      generate={{
        label: isGenerating ? "Generating…" : "Generate draft plan",
        disabled: busy,
        onClick: () => generate(false),
      }}
      actions={
        status === "approved" ? (
          <Button size="sm" full={false} disabled={busy} className="max-lg:hidden" onClick={reopen}>
            Reopen plan
          </Button>
        ) : status === "archived" ? undefined : (
          <>
            <Button
              variant="secondary"
              size="sm"
              full={false}
              disabled={busy || plan.items.length === 0}
              className="max-lg:hidden"
              onClick={() =>
                status === "draft"
                  ? setStatus(() => submitForReview(numericId, advisor.id), "Sent for review", "Can’t send this plan for review")
                  : setStatus(() => backToDraft(numericId, advisor.id), "Back to draft", "Can’t move this plan back to draft")
              }
            >
              {status === "draft" ? "Send for review" : "Back to draft"}
            </Button>
            <Button size="sm" full={false} disabled={busy || plan.items.length === 0} className="max-lg:hidden" onClick={approve}>
              Approve plan
            </Button>
          </>
        )
      }
      left={
        <>
          <span className="h-7 w-[1.5px] flex-none bg-border-subtle" />
          <span className="flex min-w-0 items-center gap-[10px]">
            <Avatar name={plan.plan.studentName} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label-16 text-ink-primary">{plan.plan.studentName}</span>
              <span className="truncate text-caption-12-regular text-ink-secondary">
                {[plan.plan.programName, load.data.extras?.expectedGraduation].filter(Boolean).join(" · ")}
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
          selectedId={selectedId}
          onSelect={setSelectedId}
          locked={frozen}
          noteErrors={noteErrors}
          onAdd={openPicker}
          onDrop={drop}
        />
        {isGenerating ? (
          <GeneratingBanner onCancel={() => generating.current?.abort()} />
        ) : generation.status === "failed" ? (
          <NoticeBanner
            message={generation.message}
            onRetry={generation.retry ?? undefined}
            onDismiss={() => setGeneration({ status: "idle" })}
          />
        ) : (
          toast && <Toast message={toast.message} undo={toast.undo && { disabled: busy, onClick: toast.undo }} />
        )}
      </div>

      {isGenerating ? (
        <PlanPanelSkeleton />
      ) : (
        <PlanPanel
          plan={plan}
          board={board}
          prerequisites={prerequisites}
          selected={selected}
          busy={busy}
          canOverride={advisor.can_override}
          terms={terms}
          editError={editError}
          onDismissError={() => {
            setEditError(null);
            setNoteErrors({});
          }}
          onSelect={setSelectedId}
          onAdd={(course, term) => add({ courseId: course.courseId, code: course.code, nodeId: course.id }, term)}
          onMove={(course, term) =>
            move(
              { courseId: course.courseId, code: course.code, nodeId: course.id },
              course.termCode ? { code: course.termCode, name: course.termLabel } : null,
              term,
            )
          }
          onConfirm={confirm}
          onSwap={swap}
          onRemove={openRemove}
          onOverride={(course) => openOverride({ courseId: course.courseId, code: course.code, nodeId: course.id }, "panel")}
          onReopen={reopen}
        />
      )}

      {dialog?.kind === "generate" && (
        <GenerateDialog
          firstName={firstName}
          status={dialog.status}
          isThisPlan={dialog.planId === numericId}
          summary={
            dialog.planId === numericId
              ? `last edited ${edited}, with ${plan.totals.courses} ${plan.totals.courses === 1 ? "course" : "courses"} ${
                  planned.length === 1 ? `in ${planned[0].name}` : `across ${planned.length} terms`
                }`
              : null
          }
          onOpenExisting={() => router.push(`/plans/${dialog.planId}${window.location.search}`)}
          onGenerate={() => generate(true)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveDialog
          code={dialog.course.code}
          termName={dialog.course.termLabel}
          dependents={dependents}
          busy={busy}
          onCancel={() => setDialog(null)}
          onRemove={() =>
            remove({ courseId: dialog.course.courseId, code: dialog.course.code, nodeId: dialog.course.id }, dialog.course.termLabel)
          }
        />
      )}
      {dialog?.kind === "approve" && (
        <ApproveDialog
          firstName={firstName}
          issues={plan.blockingIssues}
          canOverride={advisor.can_override}
          busy={busy}
          onView={(issue) => {
            setDialog(null);
            setSelectedId(`plan:${issue.code}`);
          }}
          onOverride={(issue) => openOverride({ courseId: issue.courseId!, code: issue.code! }, "approve")}
          onOverrideAll={() => openOverride(null, "approve")}
          onApprove={approve}
          onClose={() => setDialog(null)}
        />
      )}
      {overriding && (
        <OverrideDialog
          title={
            overriding.course
              ? `Override the problem with ${overriding.course.code}?`
              : `Override ${plan.blockingIssues.length === 1 ? "this problem" : `all ${plan.blockingIssues.length} problems`} and approve?`
          }
          problems={(overriding.course
            ? (plan.items.find((i) => i.courseId === overriding.course!.courseId)?.issues ?? []).filter(
                (i) => i.severity === "high" && !i.overridden,
              )
            : plan.blockingIssues
          ).map((i) => i.message)}
          confirmLabel={overriding.course ? "Override" : "Override and approve"}
          busy={busy}
          error={overrideError}
          onCancel={() => setDialog(overriding.from === "approve" ? { kind: "approve" } : null)}
          onConfirm={(note) => override(overriding.course, overriding.from, note)}
        />
      )}
      {pickerTerm && (
        <CoursePicker
          options={options[pickerTerm.code] ?? null}
          busyId={pickerBusyId}
          error={pickerError}
          onAdd={(course) => addFromPicker(course, pickerTerm)}
          onAddTo={(course, term) => addFromPicker(course, term)}
          onClose={() => setDialog(null)}
        />
      )}
    </Shell>
  );
}
