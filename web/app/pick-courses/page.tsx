"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { StudentGate, type StudentAccount } from "@/components/StudentGate";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink, TextButton } from "@/components/Button";
import { Avatar, Pill } from "@/components/Chip";
import { Select } from "@/components/Select";
import { Skeleton, StateMessage } from "@/components/State";
import { explain } from "@/lib/planApi";
import {
  getHistory,
  getProgramCourses,
  getPrograms,
  saveHistory,
  type HistoryCourse,
  type HistoryEntry,
  type Program,
  type ProgramCourse,
  type ProgramGroup,
} from "@/lib/studentApi";

type Status = "taken" | "in_progress";

// A course the student has marked. Credits are kept with the mark, so the totals still count a
// marked course that the major on screen does not list.
type Marks = Record<number, { status: Status; credits: number }>;

type Setup =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; programs: Program[]; history: HistoryCourse[] };

type Courses =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; groups: ProgramGroup[] };

type Saved = { status: "idle" } | { status: "saving" } | { status: "saved"; courses: number } | { status: "error"; reason: string };

// "science_2of5" -> "Science". The count is shown from the group's own pickCount.
const humanize = (s: string) => s.replace(/_\d+of\d+$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The PUT replaces the student's whole history, so everything already on file is sent back as it
// was (grade and term included) unless the student changed it here.
function toEntries(marks: Marks, history: HistoryCourse[]): HistoryEntry[] {
  const onFile = new Map(history.map((h) => [h.courseId, h]));
  const ids = new Set([...onFile.keys(), ...Object.keys(marks).map(Number)]);
  return [...ids].flatMap((courseId): HistoryEntry[] => {
    const was = onFile.get(courseId);
    const mark = marks[courseId];
    if (!mark) {
      // Not marked. A failed attempt was never shown as marked, so it stays on file.
      return was?.status === "not_passed" ? [{ courseId, grade: was.grade, termCode: was.termCode }] : [];
    }
    if (mark.status === "in_progress") {
      return [{ courseId, status: "in_progress", termCode: was?.status === "in_progress" ? was.termCode : null }];
    }
    return [{ courseId, status: "taken", grade: was?.status === "taken" ? was.grade : null, termCode: was?.termCode ?? null }];
  });
}

const MARK = "flex flex-none cursor-pointer items-center gap-[5px] rounded-pill border-[1.5px] px-[10px] py-[3px] text-caption-12 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-60";
const MARK_OFF = "border-border-default bg-surface-card text-ink-secondary hover:border-ink-primary hover:text-ink-primary";

function CourseRow({
  course,
  mark,
  disabled,
  onMark,
}: {
  course: ProgramCourse;
  mark: Status | null;
  disabled: boolean;
  onMark: (status: Status) => void;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-border-subtle px-[14px] py-[10px] max-sm:flex-wrap">
      <span className="w-[92px] flex-none text-label-14 text-ink-primary">{course.code}</span>
      <span className="min-w-0 flex-1 truncate text-body-14 text-ink-secondary">
        {course.title}
      </span>
      <span className="flex-none text-caption-12-regular text-ink-secondary">{course.credits} cr</span>
      <span className="flex flex-none items-center gap-1.5">
        <button
          type="button"
          aria-pressed={mark === "taken"}
          aria-label={`${course.code} taken`}
          disabled={disabled}
          onClick={() => onMark("taken")}
          className={`${MARK} ${mark === "taken" ? "border-ink-primary bg-ink-primary text-surface-card" : MARK_OFF}`}
        >
          {mark === "taken" && <Image src="/login/check.svg" alt="" width={16} height={16} />}
          Taken
        </button>
        <button
          type="button"
          aria-pressed={mark === "in_progress"}
          aria-label={`${course.code} in progress`}
          disabled={disabled}
          onClick={() => onMark("in_progress")}
          className={`${MARK} ${mark === "in_progress" ? "border-brand-gold bg-brand-gold-soft text-ink-primary" : MARK_OFF}`}
        >
          In progress
        </button>
      </span>
    </li>
  );
}

function CoursePicker({ account, onSignOut }: { account: StudentAccount; onSignOut: () => void }) {
  const { student, name } = account;
  const router = useRouter();
  const [setup, setSetup] = useState<Setup>({ status: "loading" });
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [programId, setProgramId] = useState<number | null>(student.programId);
  const [courses, setCourses] = useState<Courses>(student.programId ? { status: "loading" } : { status: "idle" });
  const [coursesAttempt, setCoursesAttempt] = useState(0);
  const [marks, setMarks] = useState<Marks>({});
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<Saved>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [programs, history] = await Promise.all([getPrograms(), getHistory(student.id)]);
        if (cancelled) return;
        const onFile: Marks = {};
        for (const h of history) if (h.status !== "not_passed") onFile[h.courseId] = { status: h.status, credits: h.credits };
        setMarks(onFile);
        setSetup({ status: "ready", programs, history });
      } catch (e) {
        if (!cancelled) setSetup({ status: "error", reason: explain(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student.id, setupAttempt]);

  useEffect(() => {
    if (programId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const groups = await getProgramCourses(programId);
        if (!cancelled) setCourses({ status: "ready", groups });
      } catch (e) {
        if (!cancelled) setCourses({ status: "error", reason: explain(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, coursesAttempt]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (courses.status === "ready" ? courses.groups : [])
      .map((group) => ({
        ...group,
        // how many of the whole group are marked, whatever the search shows
        marked: group.courses.filter((c) => marks[c.courseId]).length,
        shown: group.courses.filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)),
      }))
      .filter((group) => group.shown.length > 0);
  }, [courses, marks, query]);

  // Marked courses the major on screen does not list: taken for another major, or outside it.
  const unlisted = useMemo(() => {
    if (courses.status !== "ready") return 0;
    const listed = new Set(courses.groups.flatMap((g) => g.courses.map((c) => c.courseId)));
    return Object.keys(marks).filter((id) => !listed.has(Number(id))).length;
  }, [courses, marks]);

  if (setup.status === "error") {
    return (
      <Shell name={name} onSignOut={onSignOut}>
        <StateMessage
          kind="error"
          className="m-auto max-w-[440px]"
          action={
            <Button
              full={false}
              onClick={() => {
                setSetup({ status: "loading" });
                setSetupAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          We couldn&rsquo;t load your courses. {setup.reason}
        </StateMessage>
      </Shell>
    );
  }

  const programs = setup.status === "ready" ? setup.programs : [];
  const program = programs.find((p) => p.id === programId) ?? null;
  const saving = saved.status === "saving";
  const marked = Object.values(marks);
  const credits = (status: Status) => marked.filter((m) => m.status === status).reduce((sum, m) => sum + m.credits, 0);
  const loadingCourses = setup.status === "loading" || courses.status === "loading";

  function chooseProgram(id: number) {
    if (id === programId) return;
    setProgramId(id);
    setCourses({ status: "loading" });
    setQuery("");
    setSaved({ status: "idle" });
  }

  // Pressing the mark a course already has clears it.
  function mark(course: ProgramCourse, status: Status) {
    setSaved({ status: "idle" });
    setMarks((current) => {
      const next = { ...current };
      if (current[course.courseId]?.status === status) delete next[course.courseId];
      else next[course.courseId] = { status, credits: course.credits };
      return next;
    });
  }

  async function save() {
    if (setup.status !== "ready" || programId === null) return;
    setSaved({ status: "saving" });
    try {
      const result = await saveHistory(student.id, programId, toEntries(marks, setup.history));
      setSaved({ status: "saved", courses: result.saved });
      router.push(`/board${window.location.search}`);
    } catch (e) {
      setSaved({ status: "error", reason: explain(e) });
    }
  }

  return (
    <Shell name={name} onSignOut={onSignOut}>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-8 short:gap-4 short:pt-5 min-[1100px]:px-[120px]">
        <div className="flex flex-none flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-28 text-ink-primary">Pick the courses you&rsquo;ve taken</h1>
            <p className="text-body-14 text-ink-secondary">
              Choose your major, then mark each course you&rsquo;ve finished or are taking now.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-[10px]">
            <label className="flex h-[34px] w-[250px] items-center gap-2 rounded-[10px] border-[1.5px] border-ink-muted bg-surface-card pl-3 pr-[14px] focus-within:border-brand-gold focus-within:ring-4 focus-within:ring-brand-gold/25">
              <Image src="/advisor/search.svg" alt="" width={16} height={16} className="flex-none" />
              <input
                type="search"
                aria-label="Search by code or title"
                placeholder="Search by code or title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full min-w-0 bg-transparent text-body-14 text-ink-primary outline-none placeholder:text-ink-muted"
              />
            </label>
            <Select
              aria-label="Choose your major"
              label={`Major: ${program?.name ?? "Choose"}`}
              value={programId ?? ""}
              disabled={setup.status !== "ready" || saving}
              onChange={(e) => chooseProgram(Number(e.target.value))}
            >
              <option value="" disabled>
                Choose your major
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {loadingCourses ? (
          <div
            aria-busy="true"
            className="flex flex-none flex-col rounded-[20px] border border-border-subtle bg-surface-card px-2 pb-2 pt-1.5 shadow-note motion-safe:animate-pulse"
          >
            <span className="sr-only" role="status">
              Loading courses…
            </span>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={`flex h-12 items-center gap-3 px-[14px] ${i > 0 ? "border-t border-border-subtle" : ""}`}>
                <Skeleton className="h-3 rounded-md" width={70} />
                <span className="flex min-w-0 flex-1">
                  <Skeleton className="h-3 rounded-md" width={[180, 220, 150][i % 3]} />
                </span>
                <Skeleton className="h-6 rounded-pill" width={150} />
              </div>
            ))}
          </div>
        ) : courses.status === "idle" ? (
          <StateMessage kind="empty" className="m-auto">
            Choose your major to see its courses.
          </StateMessage>
        ) : courses.status === "error" ? (
          <StateMessage
            kind="error"
            className="m-auto"
            action={
              <Button
                full={false}
                onClick={() => {
                  setCourses({ status: "loading" });
                  setCoursesAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            }
          >
            We couldn&rsquo;t load the courses for this major. {courses.reason}
          </StateMessage>
        ) : groups.length === 0 ? (
          <StateMessage
            kind="empty"
            className="m-auto"
            action={
              query ? (
                <Button variant="secondary" full={false} onClick={() => setQuery("")}>
                  Clear search
                </Button>
              ) : undefined
            }
          >
            {query ? "No courses match your search." : "This major has no courses listed yet."}
          </StateMessage>
        ) : (
          groups.map((group) => (
            <section
              key={group.requirement}
              aria-label={humanize(group.requirement)}
              className="flex flex-none flex-col rounded-[20px] border border-border-subtle bg-surface-card px-2 pb-2 pt-1.5 shadow-note"
            >
              <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-[14px] py-2">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-overline-12 uppercase text-ink-secondary">
                    {humanize(group.requirement)}
                    {group.pickCount ? ` · pick ${group.pickCount}` : ""}
                  </h2>
                  {group.requirement === "other_prerequisites" && (
                    <p className="text-caption-12-regular text-ink-secondary">
                      Not required by your major, but needed before some of its courses.
                    </p>
                  )}
                </div>
                <span className="text-caption-12-regular whitespace-nowrap text-ink-secondary">
                  {group.marked} of {group.courses.length} marked
                </span>
              </div>
              <ul>
                {group.shown.map((course) => (
                  <CourseRow
                    key={course.courseId}
                    course={course}
                    mark={marks[course.courseId]?.status ?? null}
                    disabled={saving}
                    onMark={(status) => mark(course, status)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t-[1.5px] border-border-subtle bg-surface-card px-6 py-3 min-[1100px]:px-[120px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-label-16 text-ink-primary">
            {credits("taken")} cr taken · {credits("in_progress")} cr in progress
            {program ? <span className="text-body-14 text-ink-secondary"> · of {program.totalCredits} for this major</span> : null}
          </p>
          {saved.status === "error" ? (
            <p role="alert" className="text-caption-12 text-ink-primary">
              We couldn&rsquo;t save your courses. {saved.reason}
            </p>
          ) : saved.status === "saved" ? (
            <p role="status" className="text-caption-12 text-ink-primary">
              Saved. {plural(saved.courses, "course")} on file. Opening your board…
            </p>
          ) : (
            <p className="text-caption-12-regular text-ink-secondary">
              {plural(marked.length, "course")} marked
              {unlisted > 0 ? ` · ${unlisted} not listed under this major, still saved` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-none items-center gap-[10px]">
          <ButtonLink href="/upload" variant="secondary" full={false}>
            Upload an audit instead
          </ButtonLink>
          <Button full={false} disabled={setup.status !== "ready" || programId === null || saving} onClick={save}>
            {saving ? "Saving…" : "Build my board"}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ name, onSignOut, children }: { name: string; onSignOut: () => void; children: React.ReactNode }) {
  return (
    <main className="flex h-dvh min-h-[420px] flex-col bg-surface-canvas text-ink-primary">
      <TopBar surface tag={<Pill tone="gold">Student</Pill>}>
        <span className="truncate text-body-14 text-ink-secondary max-md:hidden">{name}</span>
        <Avatar name={name} size="md" />
        <TextButton onClick={onSignOut}>Sign out</TextButton>
      </TopBar>
      {children}
    </main>
  );
}

export default function PickCoursesPage() {
  return <StudentGate>{(account, signOut) => <CoursePicker account={account} onSignOut={signOut} />}</StudentGate>;
}
