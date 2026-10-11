"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button, TextButton } from "@/components/Button";
import type { CourseOption, CourseOptions, Dependent, PlanIssue, TermRef } from "@/lib/planApi";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Modal dialog: closes on Escape or a click outside, keeps Tab inside, and puts focus on the
// element marked data-autofocus (or the first control) when it opens.
export function Modal({
  label,
  onClose,
  scrim = false,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  scrim?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = box.current;
    (root?.querySelector<HTMLElement>("[data-autofocus]") ?? root?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${scrim ? "bg-ink-primary/40" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={className}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key !== "Tab" || !box.current) return;
          const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- generate a draft

const STATUS_TEXT = { draft: "a draft", in_review: "in review", approved: "approved", archived: "archived" };

// Shown when the API answers "plan_exists": the student already has a live plan.
export function GenerateDialog({
  firstName,
  status,
  summary,
  isThisPlan,
  onOpenExisting,
  onGenerate,
  onClose,
}: {
  firstName: string;
  status: keyof typeof STATUS_TEXT; // of the existing plan, from the API
  summary: string | null; // details of the existing plan, when it is the one on screen
  isThisPlan: boolean;
  onOpenExisting: () => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      scrim
      label={`${firstName} already has a plan`}
      onClose={onClose}
      className="flex w-full max-w-[520px] flex-col gap-[18px] rounded-panel bg-surface-card px-7 pb-6 pt-[26px] shadow-panel"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-heading-28 text-ink-primary">{firstName} already has a plan</h2>
        <p className="text-body-16 text-ink-secondary">
          It&rsquo;s {STATUS_TEXT[status]}
          {summary ? `, ${summary}` : ""}.
        </p>
      </div>
      <div className="flex flex-wrap gap-[10px]">
        <Button full={false} onClick={isThisPlan ? onClose : onOpenExisting} data-autofocus>
          {isThisPlan ? "Keep this plan" : "Open existing plan"}
        </Button>
        <Button variant="secondary" full={false} onClick={onGenerate}>
          Generate a new draft
        </Button>
      </div>
      <p className="text-caption-12-regular text-ink-secondary">
        A new draft starts from scratch. The existing plan is archived, including any courses you added.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------- remove a course

export type Dependents = { status: "loading" } | { status: "unknown" } | { status: "ready"; list: Dependent[] };

export function RemoveDialog({
  code,
  termName,
  dependents,
  busy,
  onCancel,
  onRemove,
}: {
  code: string;
  termName: string;
  dependents: Dependents; // planned courses that stop being valid if this one leaves
  busy: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <Modal
      label={`Remove ${code} from ${termName}?`}
      onClose={onCancel}
      className="flex w-full max-w-[340px] flex-col gap-3 rounded-[20px] border-2 border-ink-primary bg-surface-card px-[18px] py-4 shadow-panel"
    >
      <h2 className="text-label-16 text-ink-primary">
        Remove {code} from {termName}?
      </h2>
      {dependents.status === "loading" && <p className="text-caption-12-regular text-ink-secondary">Checking what this affects…</p>}
      {dependents.status === "unknown" && (
        <p className="text-caption-12-regular text-ink-secondary">We couldn&rsquo;t check which other courses this affects.</p>
      )}
      {dependents.status === "ready" && dependents.list.length > 0 && (
        <div className="flex flex-col gap-2 rounded-field border border-border-subtle bg-surface-canvas px-3 py-[10px]">
          <h3 className="text-overline-12 uppercase text-ink-secondary">This also affects</h3>
          {dependents.list.map((course) => (
            <div key={course.courseId} className="flex items-start gap-2">
              <Image src="/plan/affected.svg" alt="" width={16} height={16} className="mt-0.5 flex-none" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-label-14 text-ink-primary">
                  {course.code} · {course.title}
                </p>
                <p className="text-caption-12-regular text-ink-secondary">
                  {course.direct
                    ? `It needs ${code}, so it will show a conflict in ${course.termName}.`
                    : `It depends on a course that needs ${code}, so it will show a conflict in ${course.termName}.`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" full={false} onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" full={false} onClick={onRemove} disabled={busy} data-autofocus>
          {busy ? "Removing…" : "Remove"}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- approve a plan

// Shown when problems still block approval. Each one can be fixed on the board or, by an advisor
// who is authorized, overridden with a written reason.
export function ApproveDialog({
  firstName,
  issues,
  canOverride,
  busy,
  onView,
  onOverride,
  onOverrideAll,
  onApprove,
  onClose,
}: {
  firstName: string;
  issues: PlanIssue[]; // the plan's blocking problems, as they stand now
  canOverride: boolean;
  busy: boolean;
  onView: (issue: PlanIssue) => void; // show the course on the board
  onOverride: (issue: PlanIssue) => void;
  onOverrideAll: () => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const clear = issues.length === 0;
  const count = `${issues.length} ${issues.length === 1 ? "problem" : "problems"}`;
  return (
    <Modal
      scrim
      label={clear ? `Approve ${firstName}’s plan` : `${count} to resolve before approval`}
      onClose={onClose}
      className="flex max-h-[min(640px,calc(100dvh-32px))] w-full max-w-[520px] flex-col gap-[18px] rounded-panel bg-surface-card px-7 pb-6 pt-[26px] shadow-panel"
    >
      <div className="flex flex-none flex-col gap-1.5">
        <h2 className="text-heading-28 text-ink-primary">{clear ? "Nothing is blocking this plan" : `${count} to resolve`}</h2>
        <p className="text-body-16 text-ink-secondary">
          {clear
            ? `Every problem is fixed or overridden. ${firstName}’s plan can be approved.`
            : `${firstName}’s plan can’t be approved until ${issues.length === 1 ? "this is" : "these are"} fixed${
                canOverride ? " or overridden" : ""
              }.`}
        </p>
      </div>

      {!clear && (
        <ul className="-mx-7 flex min-h-0 flex-col overflow-y-auto px-7">
          {issues.map((issue, i) => (
            <li key={i} className={`flex items-start gap-2 py-[10px] ${i > 0 ? "border-t border-border-subtle" : ""}`}>
              <Image src="/plan/error-small.svg" alt="" width={18} height={18} className="mt-px flex-none" />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <p className="text-body-14 text-ink-primary">{issue.message}</p>
                {issue.courseId && issue.code && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <TextButton className="text-caption-12" aria-label={`View ${issue.code} on the board`} onClick={() => onView(issue)}>
                      View {issue.code}
                    </TextButton>
                    {canOverride && (
                      <TextButton
                        className="text-caption-12 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busy}
                        aria-label={`Override the problem with ${issue.code}`}
                        onClick={() => onOverride(issue)}
                      >
                        Override
                      </TextButton>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-none flex-wrap gap-[10px]">
        {clear ? (
          <Button full={false} disabled={busy} onClick={onApprove} data-autofocus>
            {busy ? "Approving…" : "Approve plan"}
          </Button>
        ) : (
          <>
            <Button full={false} onClick={onClose} data-autofocus>
              Back to the board
            </Button>
            {canOverride && (
              <Button variant="secondary" full={false} disabled={busy} onClick={onOverrideAll}>
                Override all and approve
              </Button>
            )}
          </>
        )}
      </div>
      {!clear && !canOverride && (
        <p className="flex-none text-caption-12-regular text-ink-secondary">
          You aren&rsquo;t authorized to override problems. Fix them on the board, or ask an advisor who is.
        </p>
      )}
    </Modal>
  );
}

// The written reason an override needs.
export function OverrideDialog({
  title,
  problems,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  problems: string[]; // what is being overridden
  confirmLabel: string;
  busy: boolean;
  error: string | null; // the API's refusal, if the last try failed
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  return (
    <Modal
      scrim
      label={title}
      onClose={onCancel}
      className="flex w-full max-w-[460px] flex-col gap-[14px] rounded-panel bg-surface-card px-7 pb-6 pt-[26px] shadow-panel"
    >
      <h2 className="text-title-18 text-ink-primary">{title}</h2>
      <ul className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto rounded-field border border-border-subtle bg-surface-canvas px-3 py-[10px] text-body-14 text-ink-primary">
        {problems.map((problem, i) => (
          <li key={i}>{problem}</li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-caption-12 text-ink-secondary">
          Reason for the override
        </label>
        <textarea
          id={noteId}
          data-autofocus
          rows={3}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this is fine for this student"
          className="w-full resize-none rounded-field border-[1.5px] border-ink-muted bg-surface-card px-[14px] py-[10px] text-body-14 text-ink-primary outline-none placeholder:text-ink-muted focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/25 disabled:opacity-70"
        />
        <p className="text-caption-12-regular text-ink-secondary">Saved on the plan with your name and the date.</p>
      </div>
      {error && (
        <p role="alert" className="text-body-14 text-ink-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" full={false} onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" full={false} disabled={busy || !note.trim()} onClick={() => onConfirm(note.trim())}>
          {busy ? "Saving…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- add a course

const CHIP = "flex flex-none items-center gap-[5px] rounded-pill py-[3px] pl-[7px] pr-[10px] text-caption-12 whitespace-nowrap";

export type PickerError = { courseId: number; message: string; suggestedTerm: TermRef | null };

export function CoursePicker({
  options,
  busyId,
  error,
  onAdd,
  onAddTo,
  onClose,
}: {
  options: CourseOptions | null; // null: the list for this term could not be loaded
  busyId: number | null; // the course being added, while the request is in flight
  error: PickerError | null;
  onAdd: (course: CourseOption) => void;
  onAddTo: (course: CourseOption, term: TermRef) => void; // "Add to <later term> instead"
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const termName = options?.term.name ?? "this term";

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (options?.groups ?? [])
      .map((group) => ({
        ...group,
        courses: group.courses.filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)),
      }))
      .filter((group) => group.courses.length > 0);
  }, [options, query]);

  return (
    <Modal
      label={`Add a course to ${termName}`}
      onClose={onClose}
      className="flex max-h-[min(640px,calc(100dvh-32px))] w-full max-w-[420px] flex-col gap-[10px] rounded-[20px] border-2 border-ink-primary bg-surface-card px-[18px] py-4 shadow-panel"
    >
      <div className="flex flex-none items-center justify-between">
        <h2 className="text-title-18 text-ink-primary">Add a course to {termName}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer rounded-pill p-1 focus-visible:outline-2 focus-visible:outline-ink-primary"
        >
          <Image src="/plan/close-small.svg" alt="" width={18} height={18} />
        </button>
      </div>

      <label className="flex flex-none items-center gap-2 rounded-[10px] border-[1.5px] border-ink-muted bg-surface-card px-3 py-[9px] focus-within:border-brand-gold focus-within:ring-4 focus-within:ring-brand-gold/25">
        <Image src="/advisor/search.svg" alt="" width={16} height={16} className="flex-none" />
        <input
          type="search"
          data-autofocus
          aria-label="Search by code or title"
          placeholder="Search by code or title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full min-w-0 bg-transparent text-body-14 text-ink-primary outline-none placeholder:text-ink-muted"
        />
      </label>

      <div className="-mx-[18px] flex min-h-0 flex-col gap-[10px] overflow-y-auto px-[18px]">
        {!options ? (
          <p role="alert" className="py-4 text-body-14 text-ink-primary">
            We couldn&rsquo;t load the courses for this term. Close this and try again.
          </p>
        ) : (
          groups.length === 0 && <p className="py-4 text-body-14 text-ink-secondary">No remaining courses match.</p>
        )}
        {groups.map((group) => (
          <section key={group.requirement} className="flex flex-col gap-[10px]">
            <h3 className="pt-1.5 text-overline-12 uppercase text-ink-secondary">{humanize(group.fills ?? group.requirement)}</h3>
            <ul className="flex flex-col">
              {group.courses.map((course) => {
                const failed = error?.courseId === course.courseId ? error : null;
                const adding = busyId === course.courseId;
                const text = (
                  <>
                    <span className="w-[92px] flex-none text-label-14 text-ink-primary">{course.code}</span>
                    <span className="min-w-0 flex-1 truncate text-body-14 text-ink-secondary">{course.title}</span>
                  </>
                );
                return (
                  <li
                    key={course.courseId}
                    className={`flex flex-col gap-2 rounded-[10px] ${failed ? "border-2 border-ink-primary bg-surface-sunken" : ""}`}
                  >
                    {course.prerequisitesMet ? (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => onAdd(course)}
                        className="group flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-[10px] py-2 text-left outline-none hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {text}
                        {adding ? (
                          <span className={`${CHIP} bg-surface-sunken pl-[10px] text-ink-secondary`}>Adding…</span>
                        ) : (
                          <>
                            {/* "Prereqs met" at rest; the row's action shows on hover or focus. */}
                            <span
                              className={`${CHIP} border-[1.5px] border-border-default bg-surface-card text-ink-primary group-hover:hidden group-focus-visible:hidden`}
                            >
                              <Image src="/plan/check-dark.svg" alt="" width={16} height={16} />
                              Prereqs met
                            </span>
                            <span
                              className={`${CHIP} hidden border-[1.5px] border-ink-on-gold bg-brand-gold px-[14px] text-ink-on-gold group-hover:flex group-focus-visible:flex`}
                            >
                              Add
                            </span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 px-[10px] py-2">
                        {text}
                        <span className={`${CHIP} bg-ink-primary text-surface-card`}>
                          <Image src="/plan/conflict-lock.svg" alt="" width={16} height={16} />
                          {course.missing.length > 0 ? `Needs ${course.missing[0]}` : "Locked"}
                          {course.missing.length > 1 ? ` +${course.missing.length - 1}` : ""}
                        </span>
                      </div>
                    )}
                    {failed && (
                      <div role="alert" className="flex items-start gap-2 px-[10px] pb-2">
                        <Image src="/plan/error-small.svg" alt="" width={18} height={18} className="flex-none" />
                        <div className="flex min-w-0 flex-col items-start gap-1">
                          <p className="text-body-14 text-ink-primary">
                            Can&rsquo;t add {course.code} to {termName}. {failed.message} Nothing was added.
                          </p>
                          {failed.suggestedTerm && (
                            <TextButton
                              className="text-caption-12 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={busyId !== null}
                              onClick={() => onAddTo(course, failed.suggestedTerm!)}
                            >
                              Add to {failed.suggestedTerm.name} instead
                            </TextButton>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- toast and banners

const FLOAT = "absolute bottom-[104px] left-1/2 z-20 -translate-x-1/2";

// Confirmation of a change that went through, with Undo when the API can take it back.
export function Toast({ message, undo }: { message: string; undo?: { disabled: boolean; onClick: () => void } }) {
  return (
    <div
      role="status"
      className={`${FLOAT} flex items-center gap-4 rounded-row bg-ink-primary px-[18px] py-3 text-label-14 whitespace-nowrap text-surface-card shadow-panel`}
    >
      <span className="flex items-center gap-2">
        <Image src="/plan/toast-check.svg" alt="" width={16} height={16} />
        {message}
      </span>
      {undo && (
        <button
          type="button"
          disabled={undo.disabled}
          onClick={undo.onClick}
          className="cursor-pointer text-label-14 text-brand-gold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
        >
          Undo
        </button>
      )}
    </div>
  );
}

const BANNER =
  "flex items-center gap-3 rounded-card border-[1.5px] border-ink-primary bg-surface-card px-4 py-3 text-body-14 text-ink-primary shadow-note-lifted";

// The API reports no progress, so the banner does not count courses. Cancel aborts the request;
// the server saves nothing for a cancelled request.
export function GeneratingBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div role="status" className={`${FLOAT} ${BANNER} whitespace-nowrap`}>
      <Image src="/plan/spinner.svg" alt="" width={22} height={22} className="flex-none motion-safe:animate-spin" />
      Generating a draft plan. This can take up to a minute.
      <TextButton onClick={onCancel}>Cancel</TextButton>
    </div>
  );
}

export function NoticeBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className={`${FLOAT} ${BANNER} w-[min(610px,calc(100%-48px))]`}>
      <Image src="/plan/warning.svg" alt="" width={22} height={22} className="flex-none" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button size="sm" full={false} onClick={onRetry}>
          Try again
        </Button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-none cursor-pointer rounded-pill p-1 focus-visible:outline-2 focus-visible:outline-ink-primary"
      >
        <Image src="/plan/close-small.svg" alt="" width={18} height={18} />
      </button>
    </div>
  );
}
