"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudentGate, type StudentAccount } from "@/components/StudentGate";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink, TextButton } from "@/components/Button";
import { Avatar, Pill, PlanStatusChip } from "@/components/Chip";
import { CourseNode, type CourseState } from "@/components/CourseNode";
import { StateMessage } from "@/components/State";
import { codeOf, explain, PlanApiError } from "@/lib/planApi";
import { boardAdd, boardMove, boardRemove, getBoard, type BoardCourse, type StudentBoard } from "@/lib/studentApi";

type Load = { status: "loading" } | { status: "error"; reason: string } | { status: "ready"; board: StudentBoard };

// `action` is a way forward the API offered, e.g. "Add to Fall 2027".
type Notice = { message: string; action?: { label: string; onClick: () => void } };

const STATE: Record<BoardCourse["status"], CourseState> = {
  taken: "taken",
  in_progress: "in-progress",
  planned: "available",
  available: "available",
  locked: "locked",
};

const statusLabel = (c: BoardCourse) =>
  c.status === "planned"
    ? "Planned"
    : c.status === "locked" && c.needs.length > 0
      ? `Needs ${c.needs[0]}${c.needs.length > 1 ? ` +${c.needs.length - 1}` : ""}`
      : undefined;

function Note({ course, selected, onSelect }: { course: BoardCourse; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="block flex-none cursor-pointer rounded-card text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-primary"
    >
      <CourseNode
        code={course.code}
        title={course.title}
        credits={`${course.credits} cr`}
        state={STATE[course.status]}
        status={statusLabel(course)}
        grade={course.grade}
        selected={selected}
      />
    </button>
  );
}

function Board({ account, onSignOut }: { account: StudentAccount; onSignOut: () => void }) {
  const { student, name } = account;
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await getBoard(student.id);
        if (!cancelled) setLoad({ status: "ready", board });
      } catch (e) {
        if (cancelled) return;
        // No major on file yet: the board has nothing to show until one is saved.
        if (codeOf(e) === "no_program") router.replace("/upload");
        else setLoad({ status: "error", reason: explain(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student.id, attempt, router]);

  const shell = (children: React.ReactNode, tag?: React.ReactNode) => (
    <main className="flex h-dvh min-h-[420px] flex-col bg-surface-canvas text-ink-primary">
      <TopBar
        surface
        tag={
          <>
            <Pill tone="gold">Student</Pill>
            {tag}
          </>
        }
      >
        <span className="truncate text-body-14 text-ink-secondary max-md:hidden">{name}</span>
        <Avatar name={name} size="md" />
        <TextButton onClick={onSignOut}>Sign out</TextButton>
      </TopBar>
      {children}
    </main>
  );

  if (load.status === "loading") return shell(<p className="p-6 text-body-14 text-ink-secondary">Loading your board…</p>);

  if (load.status === "error") {
    return shell(
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
        We couldn&rsquo;t load your board. {load.reason}
      </StateMessage>,
    );
  }

  const { board } = load;
  const { header } = board;
  const planTerms = board.terms.filter((t) => t.state === "planned");
  const selected = board.courses.find((c) => c.courseId === selectedId) ?? null;
  const pool = (status: BoardCourse["status"]) => board.courses.filter((c) => c.status === status && c.termCode === null);
  const earlier = pool("taken");
  const termName = (code: string) => board.terms.find((t) => t.code === code)?.name ?? code;

  // Runs one change, then re-reads the board so the header and every note are current.
  async function change(action: () => Promise<unknown>, done: string, retry?: (termCode: string) => void) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setLoad({ status: "ready", board: await getBoard(student.id) });
      setNotice({ message: done });
    } catch (e) {
      const next = e instanceof PlanApiError ? e.suggestedTerm : null;
      setNotice({
        message: explain(e),
        action: next && retry ? { label: `Use ${next.name} instead`, onClick: () => retry(next.code) } : undefined,
      });
    }
    setBusy(false);
  }

  const add = (c: BoardCourse, termCode: string): Promise<void> =>
    change(() => boardAdd(student.id, c.courseId, termCode), `${c.code} added to ${termName(termCode)}`, (code) => add(c, code));
  const move = (c: BoardCourse, termCode: string): Promise<void> =>
    change(() => boardMove(student.id, c.courseId, termCode), `${c.code} moved to ${termName(termCode)}`, (code) => move(c, code));
  const remove = (c: BoardCourse) => change(() => boardRemove(student.id, c.courseId), `${c.code} taken off your plan`);

  return shell(
    <>
      <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-b border-border-subtle px-6 py-3 text-body-14 text-ink-secondary">
        <span>
          <b className="text-label-16 text-ink-primary">{header.creditsCompleted}</b> of {header.creditsTotal} credits done
        </span>
        <span>{header.creditsInProgress} in progress</span>
        <span>{header.creditsPlanned} planned</span>
        {header.gpa !== null && <span>GPA {Number(header.gpa).toFixed(2)}</span>}
        {header.projectedGraduation && <span>Graduating {header.projectedGraduation.name}</span>}
        <ButtonLink href="/pick-courses" variant="secondary" size="sm" full={false} className="ml-auto">
          Edit courses taken
        </ButtonLink>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-6 py-6">
        <div className="flex flex-none gap-10">
          {earlier.length > 0 && (
            <Column title="Earlier" sub="No term on file">
              {earlier.map((c) => (
                <Note key={c.courseId} course={c} selected={c.courseId === selectedId} onSelect={() => setSelectedId(c.courseId)} />
              ))}
            </Column>
          )}
          {board.terms.map((term) => {
            const notes = board.courses.filter((c) => c.termCode === term.code);
            return (
              <Column key={term.code} title={term.name} sub={`${term.label} · ${term.credits} cr`} plan={term.state === "planned"}>
                {notes.map((c) => (
                  <Note key={c.courseId} course={c} selected={c.courseId === selectedId} onSelect={() => setSelectedId(c.courseId)} />
                ))}
                {notes.length === 0 && <p className="text-caption-12-regular text-ink-secondary">Nothing here yet.</p>}
              </Column>
            );
          })}
        </div>

        {(
          [
            ["Available now", pool("available")],
            ["Locked", pool("locked")],
          ] as const
        ).map(
          ([label, notes]) =>
            notes.length > 0 && (
              <section key={label} className="flex flex-none flex-col gap-3">
                <h2 className="text-overline-12 uppercase text-ink-secondary">
                  {label} · {notes.length} not yet planned
                </h2>
                <div className="flex flex-wrap gap-4">
                  {notes.map((c) => (
                    <Note key={c.courseId} course={c} selected={c.courseId === selectedId} onSelect={() => setSelectedId(c.courseId)} />
                  ))}
                </div>
              </section>
            ),
        )}
      </div>

      {(selected || notice) && (
        <div className="flex flex-none flex-col gap-2 border-t-[1.5px] border-border-subtle bg-surface-card px-6 py-3">
          {notice && (
            <div role="status" className="flex flex-wrap items-center gap-3 text-body-14 text-ink-primary">
              <span>{notice.message}</span>
              {notice.action && (
                <TextButton disabled={busy} onClick={notice.action.onClick}>
                  {notice.action.label}
                </TextButton>
              )}
            </div>
          )}
          {selected && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-label-14 text-ink-primary">
                {selected.code} · {selected.title}
              </span>
              {!board.editable ? (
                <span className="text-body-14 text-ink-secondary">Your advisor approved this plan, so it can&rsquo;t be changed.</span>
              ) : selected.status === "planned" ? (
                <>
                  {planTerms
                    .filter((t) => t.code !== selected.termCode)
                    .map((t) => (
                      <Button key={t.code} variant="secondary" size="sm" full={false} disabled={busy} onClick={() => move(selected, t.code)}>
                        Move to {t.name}
                      </Button>
                    ))}
                  <Button variant="secondary" size="sm" full={false} disabled={busy} onClick={() => remove(selected)}>
                    Remove from plan
                  </Button>
                </>
              ) : selected.status === "available" || selected.status === "locked" ? (
                planTerms.map((t, i) => (
                  <Button key={t.code} variant={i === 0 ? "gold" : "secondary"} size="sm" full={false} disabled={busy} onClick={() => add(selected, t.code)}>
                    Add to {t.name}
                  </Button>
                ))
              ) : (
                <span className="text-body-14 text-ink-secondary">
                  {selected.status === "taken" ? "Already taken." : "You are taking this now."}
                </span>
              )}
              <TextButton className="ml-auto" onClick={() => setSelectedId(null)}>
                Close
              </TextButton>
            </div>
          )}
        </div>
      )}
    </>,
    board.plan && <PlanStatusChip status={board.plan.status} />,
  );
}

function Column({ title, sub, plan = false, children }: { title: string; sub: string; plan?: boolean; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className={`flex flex-none flex-col gap-4 rounded-panel p-3 ${plan ? "border border-brand-gold/40 bg-brand-gold-soft/45" : ""}`}
    >
      <div className="flex flex-col">
        <h2 className="text-title-18 text-ink-primary">{title}</h2>
        <p className="text-caption-12-regular text-ink-secondary">{sub}</p>
      </div>
      {children}
    </section>
  );
}

export default function BoardPage() {
  return <StudentGate>{(account, signOut) => <Board account={account} onSignOut={signOut} />}</StudentGate>;
}
