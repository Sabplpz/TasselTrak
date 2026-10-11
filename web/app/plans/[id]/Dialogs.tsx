"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/Button";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

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

// Shown before generating: this page always has a plan open, so a new draft always replaces one.
export function GenerateDialog({
  firstName,
  status,
  updatedAt,
  courses,
  termName,
  onKeep,
  onGenerate,
}: {
  firstName: string;
  status: keyof typeof STATUS_TEXT;
  updatedAt: string;
  courses: number;
  termName: string;
  onKeep: () => void;
  onGenerate: () => void;
}) {
  const edited = new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <Modal
      scrim
      label={`${firstName} already has a plan`}
      onClose={onKeep}
      className="flex w-full max-w-[520px] flex-col gap-[18px] rounded-panel bg-surface-card px-7 pb-6 pt-[26px] shadow-panel"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-heading-28 text-ink-primary">{firstName} already has a plan</h2>
        <p className="text-body-16 text-ink-secondary">
          It&rsquo;s {STATUS_TEXT[status]}, last edited {edited}, with {courses} {courses === 1 ? "course" : "courses"} in{" "}
          {termName}.
        </p>
      </div>
      <div className="flex flex-wrap gap-[10px]">
        <Button full={false} onClick={onKeep} data-autofocus>
          Keep this plan
        </Button>
        <Button variant="secondary" full={false} onClick={onGenerate}>
          Generate a new draft
        </Button>
      </div>
      <p className="text-caption-12-regular text-ink-secondary">
        {status === "approved"
          ? "A new draft becomes the current plan and starts from scratch. The approved plan is kept."
          : "A new draft starts from scratch. This plan is archived, including any courses you added."}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------- remove a course

export function RemoveDialog({
  code,
  termName,
  affected,
  busy,
  onCancel,
  onRemove,
}: {
  code: string;
  termName: string;
  affected: { code: string; title: string }[]; // planned courses that list this one as a prerequisite
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
      {affected.length > 0 && (
        <div className="flex flex-col gap-2 rounded-field border border-border-subtle bg-surface-canvas px-3 py-[10px]">
          <h3 className="text-overline-12 uppercase text-ink-secondary">This also affects</h3>
          {affected.map((course) => (
            <div key={course.code} className="flex items-start gap-2">
              <Image src="/plan/affected.svg" alt="" width={16} height={16} className="mt-0.5 flex-none" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-label-14 text-ink-primary">
                  {course.code} · {course.title}
                </p>
                <p className="text-caption-12-regular text-ink-secondary">
                  It lists {code} as a prerequisite, so it may show a conflict.
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

// ---------------------------------------------------------------- add a course

export type PickerCourse = {
  courseId: number;
  code: string;
  title: string;
  group: string; // requirement category, e.g. "Core"
  pick: number | null; // "pick N" for groups where only some courses are needed
  state: "eligible" | "locked" | "planned";
  needs: string | null; // for locked courses: "Needs COP 3502C"
};

const CHIP = "flex flex-none items-center gap-[5px] rounded-pill py-[3px] pl-[7px] pr-[10px] text-caption-12 whitespace-nowrap";

export function CoursePicker({
  termName,
  courses,
  busyId,
  error,
  onAdd,
  onClose,
}: {
  termName: string;
  courses: PickerCourse[];
  busyId: number | null; // the course being added, while the request is in flight
  error: { courseId: number; message: string } | null;
  onAdd: (course: PickerCourse) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = courses.filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
    const byGroup = new Map<string, PickerCourse[]>();
    for (const course of shown) byGroup.set(course.group, [...(byGroup.get(course.group) ?? []), course]);
    return [...byGroup.entries()];
  }, [courses, query]);

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
        {groups.length === 0 && <p className="py-4 text-body-14 text-ink-secondary">No remaining courses match.</p>}
        {groups.map(([group, rows]) => (
          <section key={group} className="flex flex-col gap-[10px]">
            <div className="flex items-center justify-between pt-1.5 text-ink-secondary">
              <h3 className="text-overline-12 uppercase">{group}</h3>
              {rows[0].pick !== null && <span className="text-caption-12-regular">pick {rows[0].pick}</span>}
            </div>
            <ul className="flex flex-col">
              {rows.map((course) => {
                const failed = error?.courseId === course.courseId;
                const adding = busyId === course.courseId;
                const text = (
                  <>
                    <span
                      className={`w-[92px] flex-none text-label-14 ${course.state === "planned" ? "text-ink-muted" : "text-ink-primary"}`}
                    >
                      {course.code}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-body-14 ${course.state === "planned" ? "text-ink-muted" : "text-ink-secondary"}`}
                    >
                      {course.title}
                    </span>
                  </>
                );
                return (
                  <li
                    key={course.courseId}
                    className={`flex flex-col gap-2 rounded-[10px] ${failed ? "border-2 border-ink-primary bg-surface-sunken" : ""}`}
                  >
                    {course.state === "eligible" ? (
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
                        {course.state === "planned" ? (
                          <span className={`${CHIP} bg-surface-sunken pl-[10px] text-ink-secondary`}>Already in plan</span>
                        ) : (
                          <span className={`${CHIP} bg-ink-primary text-surface-card`}>
                            <Image src="/plan/conflict-lock.svg" alt="" width={16} height={16} />
                            {course.needs ?? "Locked"}
                          </span>
                        )}
                      </div>
                    )}
                    {failed && (
                      <div role="alert" className="flex items-start gap-2 px-[10px] pb-2">
                        <Image src="/plan/error-small.svg" alt="" width={18} height={18} className="flex-none" />
                        <p className="text-body-14 text-ink-primary">
                          Can&rsquo;t add {course.code} to {termName}. {error.message} Nothing was added.
                        </p>
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

// Confirmation of a change that went through. No Undo: the API has no way to restore an item.
export function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className={`${FLOAT} flex items-center gap-2 rounded-row bg-ink-primary px-[18px] py-3 text-label-14 whitespace-nowrap text-surface-card shadow-panel`}
    >
      <Image src="/plan/toast-check.svg" alt="" width={16} height={16} />
      {message}
    </div>
  );
}

const BANNER =
  "flex items-center gap-3 rounded-card border-[1.5px] border-ink-primary bg-surface-card px-4 py-3 text-body-14 text-ink-primary shadow-note-lifted";

export function GeneratingBanner() {
  return (
    <div role="status" className={`${FLOAT} ${BANNER} whitespace-nowrap`}>
      <Image src="/plan/spinner.svg" alt="" width={22} height={22} className="flex-none motion-safe:animate-spin" />
      Generating a draft plan. This can take up to a minute.
    </div>
  );
}

export function FailedBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className={`${FLOAT} ${BANNER} w-[min(610px,calc(100%-48px))]`}>
      <Image src="/plan/warning.svg" alt="" width={22} height={22} className="flex-none" />
      <p className="min-w-0 flex-1">Couldn&rsquo;t generate a draft plan. {message}</p>
      <Button size="sm" full={false} onClick={onRetry}>
        Try again
      </Button>
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
