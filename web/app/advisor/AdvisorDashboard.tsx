"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { TopBar } from "@/components/TopBar";
import { Button, ButtonLink, TextButton } from "@/components/Button";
import { Avatar, Pill, RiskChip, Tag, type RiskLevel } from "@/components/Chip";
import { Select } from "@/components/Select";

export type Advisor = { id: number; name: string; email: string; department: string | null };

// Row from GET /api/caseload
type CaseloadStudent = {
  student_id: number;
  display_name: string;
  program_name: string | null;
  credits_earned: number;
  credits_in_progress: number;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  plan_id: number | null;
};

type Caseload =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; students: CaseloadStudent[]; total: number };

type RiskFactor = { raw?: Record<string, unknown>; contribution?: number };

// Parts of GET /api/students/:id that the panel shows
type StudentDetail = {
  student: { expected_graduation: string | null; is_synthetic: boolean };
  risk: { risk_score: number; risk_level: RiskLevel; factors: Record<string, RiskFactor> | null } | null;
};

type Detail = { id: number; error?: string; data?: StudentDetail };

const SORTS = { "risk-desc": "Risk, high to low", "risk-asc": "Risk, low to high", name: "Name, A to Z" };
type Sort = keyof typeof SORTS;

const points = (score: number) => Math.round(score * 100);
const plural = (n: unknown, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Title, icon and a one-line detail for each factor the risk model reports. The detail only
// restates the factor's own `raw` values.
const FACTORS: Record<string, { title: string; icon: string; detail: (raw: Record<string, unknown>) => string }> = {
  open_flags: {
    title: "Open flags",
    icon: "/advisor/risk-medium.svg",
    detail: (r) => plural(r.count, "open flag"),
  },
  non_passing: {
    title: "Courses not passed",
    icon: "/advisor/factor-x.svg",
    detail: (r) => `${plural(r.unresolved_count, "course")} not passed yet`,
  },
  pace_shortfall: {
    title: "Behind expected pace",
    icon: "/advisor/factor-behind.svg",
    detail: (r) => `${r.earned_credits} credits earned, ${r.expected_credits} expected`,
  },
  gpa_decline: {
    title: "GPA trending down",
    icon: "/advisor/factor-trend-down.svg",
    detail: (r) => `GPA change: ${r.gpa_change}`,
  },
  retakes: {
    title: "Course retakes",
    icon: "/advisor/factor-x.svg",
    detail: (r) => plural(r.count, "retake"),
  },
  work_hours: {
    title: "Work hours",
    icon: "/advisor/risk-medium.svg",
    detail: (r) => `${r.hours_per_week} hours of work per week`,
  },
  load_vs_target: {
    title: "Course load vs target",
    icon: "/advisor/risk-medium.svg",
    detail: (r) => `${r.inprogress_credits} credits in progress, target ${r.target_credits}`,
  },
};

const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function describeFactor(key: string, factor: RiskFactor) {
  const raw = factor.raw ?? {};
  const known = FACTORS[key];
  return {
    title: known?.title ?? humanize(key),
    icon: known?.icon ?? "/advisor/risk-medium.svg",
    detail:
      known?.detail(raw) ??
      Object.entries(raw)
        .map(([k, v]) => `${humanize(k)}: ${v}`)
        .join(", "),
  };
}

function FactorIcon({ src }: { src: string }) {
  // The Figma factor icons are complete 36px tiles. Other icons get the same tile around them.
  if (src.includes("/factor-")) return <Image src={src} alt="" width={36} height={36} className="flex-none" />;
  return (
    <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-brand-gold-soft">
      <Image src={src} alt="" width={16} height={16} />
    </span>
  );
}

function SectionLabel({ children, sample }: { children: React.ReactNode; sample: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-overline-12 uppercase whitespace-nowrap text-ink-secondary">{children}</h3>
      {sample && <Tag>Sample data</Tag>}
    </div>
  );
}

function Stat({ label, value, hug }: { label: string; value: React.ReactNode; hug?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col ${hug ? "flex-none" : "flex-1"} gap-0.5 rounded-field border border-border-subtle bg-surface-canvas px-3 py-[10px]`}>
      <span className="text-caption-12-regular text-ink-secondary">{label}</span>
      <span className="truncate text-label-16 text-ink-primary">{value}</span>
    </div>
  );
}

function StudentPanel({
  row,
  detail,
  onRetry,
  onClose,
}: {
  row: CaseloadStudent;
  detail: Detail | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const data = detail?.id === row.student_id ? detail.data : undefined;
  const error = detail?.id === row.student_id ? detail.error : undefined;
  const firstName = row.display_name.trim().split(/\s+/)[0];
  const sample = data?.student.is_synthetic === true;

  const factors = Object.entries(data?.risk?.factors ?? {})
    .filter(([, f]) => (f.contribution ?? 0) > 0)
    .sort(([, a], [, b]) => (b.contribution ?? 0) - (a.contribution ?? 0));

  return (
    <aside
      aria-label={`${row.display_name} details`}
      className="absolute inset-y-4 right-4 z-10 flex w-[400px] max-w-[calc(100%-32px)] flex-col gap-6 rounded-panel border border-border-subtle bg-surface-card px-6 pb-6 pt-5 shadow-panel short:inset-y-3 short:gap-4 short:pb-4 short:pt-4"
    >
      <div className="flex flex-none items-start gap-[14px]">
        <Avatar name={row.display_name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-heading-28 text-ink-primary">{row.display_name}</h2>
          {row.program_name && <p className="truncate text-body-14 text-ink-secondary">{row.program_name}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close student panel"
          className="flex-none cursor-pointer rounded-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary"
        >
          <Image src="/advisor/close.svg" alt="" width={32} height={32} />
        </button>
      </div>

      <div className="-mx-6 flex min-h-0 flex-col gap-6 overflow-y-auto px-6 short:gap-4">
        <div className="flex gap-2">
          <Stat label="Credits done" value={row.credits_earned} />
          <Stat label="In progress" value={row.credits_in_progress} />
          <Stat hug label="Graduation" value={data ? (data.student.expected_graduation ?? "Not set") : "…"} />
        </div>

        {error ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-body-14 text-ink-primary">
            <p>Could not load this student. {error}</p>
            <TextButton onClick={onRetry}>Try again</TextButton>
          </div>
        ) : !data ? (
          <p className="text-body-14 text-ink-secondary">Loading student…</p>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <SectionLabel sample={sample}>Student risk score</SectionLabel>
              <div className="flex flex-col gap-[10px] rounded-card border-[1.5px] border-ink-primary bg-surface-canvas px-[18px] pb-[18px] pt-4">
                {data.risk ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="flex items-end gap-1.5 whitespace-nowrap">
                        <span className="text-display-44 text-ink-primary">{points(data.risk.risk_score)}</span>
                        <span className="text-body-16 text-ink-secondary">/ 100</span>
                      </p>
                      <RiskChip level={data.risk.risk_level} detail="risk" />
                    </div>
                    <div className="h-[10px] overflow-clip rounded-pill border border-border-default bg-surface-sunken">
                      <div className="h-full bg-ink-primary" style={{ width: `${points(data.risk.risk_score)}%` }} />
                    </div>
                    {/* Labels start where each level starts: low from 0, medium from 25, high from 50. */}
                    <div className="grid grid-cols-4 text-caption-12-regular text-ink-secondary">
                      <span>Low</span>
                      <span>Medium</span>
                      <span className="col-span-2">High</span>
                    </div>
                  </>
                ) : (
                  <p className="text-label-14 text-ink-primary">No risk score has been computed for this student yet.</p>
                )}
                <p className="text-body-14 text-ink-primary">
                  Advisory only. The score informs a conversation and never restricts enrollment or blocks a plan.
                </p>
              </div>
            </section>

            {data.risk && (
              <section className="flex flex-col gap-3">
                <SectionLabel sample={sample}>Contributing factors</SectionLabel>
                {factors.length === 0 ? (
                  <p className="text-body-14 text-ink-secondary">No factors are adding to this score.</p>
                ) : (
                  <ul className="flex flex-col">
                    {factors.map(([key, factor], i) => {
                      const f = describeFactor(key, factor);
                      return (
                        <li
                          key={key}
                          className={`flex items-center gap-3 py-3 ${i > 0 ? "border-t border-border-subtle" : ""}`}
                        >
                          <FactorIcon src={f.icon} />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <p className="text-label-14 text-ink-primary">{f.title}</p>
                            <p className="text-caption-12-regular text-ink-secondary">{f.detail}</p>
                          </div>
                          <span className="flex-none text-caption-12 text-ink-secondary">
                            +{points(factor.contribution ?? 0)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <div className="flex flex-none flex-col items-center gap-2">
        {row.plan_id ? (
          <>
            <ButtonLink href={`/plans/${row.plan_id}`} prefetch={false}>
              View board
            </ButtonLink>
            <p className="flex items-center gap-1.5 text-caption-12-regular text-ink-secondary">
              <Image src="/advisor/eye.svg" alt="" width={16} height={16} />
              Opens {firstName}&rsquo;s canvas in read-only mode
            </p>
          </>
        ) : (
          <Button disabled>No plan yet</Button>
        )}
      </div>
    </aside>
  );
}

const TH = "text-overline-12 uppercase whitespace-nowrap text-ink-secondary";

export function AdvisorDashboard({ advisor, onSignOut }: { advisor: Advisor; onSignOut: () => void }) {
  const [caseload, setCaseload] = useState<Caseload>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [major, setMajor] = useState("");
  const [sort, setSort] = useState<Sort>("risk-desc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const requestedId = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/caseload?advisorId=${advisor.id}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
        if (!cancelled) setCaseload({ status: "ready", students: body.students, total: body.summary.total });
      } catch (e) {
        if (!cancelled) setCaseload({ status: "error", message: e instanceof Error ? e.message : "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advisor.id, attempt]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  async function openStudent(id: number) {
    setSelectedId(id);
    setDetail(null);
    requestedId.current = id;
    try {
      const res = await fetch(`/api/students/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      // A slower response for a row the advisor has already left must not replace the current one.
      if (requestedId.current === id) setDetail({ id, data: body });
    } catch (e) {
      if (requestedId.current === id) setDetail({ id, error: e instanceof Error ? e.message : "" });
    }
  }

  const students = useMemo(() => (caseload.status === "ready" ? caseload.students : []), [caseload]);
  const majors = useMemo(
    () => [...new Set(students.map((s) => s.program_name).filter((m): m is string => !!m))].sort(),
    [students],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = students.filter(
      (s) => (!q || s.display_name.toLowerCase().includes(q)) && (!major || s.program_name === major),
    );
    const byName = (a: CaseloadStudent, b: CaseloadStudent) => a.display_name.localeCompare(b.display_name);
    if (sort === "name") return rows.sort(byName);
    // Students without a score go last in either direction.
    return rows.sort((a, b) => {
      if (a.risk_score === null || b.risk_score === null) {
        return a.risk_score === b.risk_score ? byName(a, b) : a.risk_score === null ? 1 : -1;
      }
      return (sort === "risk-desc" ? b.risk_score - a.risk_score : a.risk_score - b.risk_score) || byName(a, b);
    });
  }, [students, query, major, sort]);

  const selected = students.find((s) => s.student_id === selectedId) ?? null;
  const open = selected !== null;
  const highRisk = students.filter((s) => s.risk_level === "high").length;
  const gap = open ? "gap-[14px]" : "gap-4";

  return (
    <main className="flex h-dvh min-h-[420px] flex-col bg-surface-canvas text-ink-primary">
      <TopBar surface tag={<Pill tone="gold">Advisor</Pill>}>
        <span className="truncate text-body-14 text-ink-secondary max-md:hidden">
          {advisor.department ? `${advisor.name} · ${advisor.department}` : advisor.name}
        </span>
        <Avatar name={advisor.name} size="md" />
        <TextButton onClick={onSignOut}>Sign out</TextButton>
      </TopBar>

      <div
        className={`relative flex min-h-0 flex-1 flex-col gap-5 px-6 pb-5 pt-8 short:gap-4 short:pb-4 short:pt-5 ${
          open ? "lg:pl-10 lg:pr-[440px]" : "min-[1100px]:px-[120px]"
        }`}
      >
        <div className="flex flex-none flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-28 whitespace-nowrap text-ink-primary">Your students</h1>
            <p className="text-body-14 text-ink-secondary">
              {caseload.status === "ready"
                ? `${plural(caseload.total, "student")} · ${highRisk} high risk${
                    open ? "" : " · click a row to open that student’s board"
                  }`
                : caseload.status === "loading"
                  ? "Loading your students…"
                  : "Your students could not be loaded"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-[10px]">
            <label
              className={`flex h-[34px] items-center gap-2 rounded-[10px] border-[1.5px] border-ink-muted bg-surface-card pl-3 pr-[14px] focus-within:border-brand-gold focus-within:ring-4 focus-within:ring-brand-gold/25 ${
                open ? "w-[190px]" : "w-[250px]"
              }`}
            >
              <Image src="/advisor/search.svg" alt="" width={16} height={16} className="flex-none" />
              <input
                type="search"
                aria-label="Search by name"
                placeholder="Search by name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full min-w-0 bg-transparent text-body-14 text-ink-primary outline-none placeholder:text-ink-muted"
              />
            </label>
            <Select aria-label="Filter by major" label={`Major: ${major || "All"}`} value={major} onChange={(e) => setMajor(e.target.value)}>
              <option value="">All</option>
              {majors.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Select aria-label="Sort students" label={`Sort: ${SORTS[sort]}`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(Object.keys(SORTS) as Sort[]).map((key) => (
                <option key={key} value={key}>
                  {SORTS[key]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-[20px] border border-border-subtle bg-surface-card px-2 pb-2 pt-1.5 shadow-note">
          <div className={`flex h-10 flex-none items-center px-[14px] ${gap}`}>
            <span className={`min-w-0 flex-1 ${TH}`}>Student</span>
            <span className={`w-[200px] max-md:hidden ${TH}`}>Major</span>
            <span className={`w-[150px] max-sm:hidden ${TH}`}>Credits earned</span>
            <span className={`w-[124px] ${TH} ${sort === "name" ? "" : "text-ink-primary"}`}>
              Risk score{sort === "risk-desc" ? "  ↓" : sort === "risk-asc" ? "  ↑" : ""}
            </span>
            <span className="w-4" />
          </div>

          {caseload.status === "loading" ? (
            <p className="border-t border-border-subtle px-[14px] py-5 text-body-14 text-ink-secondary">
              Loading students…
            </p>
          ) : caseload.status === "error" ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 border-t border-border-subtle px-[14px] py-5 text-body-14 text-ink-primary"
            >
              <p>Could not load your students. {caseload.message}</p>
              <TextButton
                onClick={() => {
                  setCaseload({ status: "loading" });
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </TextButton>
            </div>
          ) : visible.length === 0 ? (
            <p className="border-t border-border-subtle px-[14px] py-5 text-body-14 text-ink-secondary">
              {students.length === 0 ? "No students are assigned to you yet." : "No students match your search."}
            </p>
          ) : (
            <ul className="min-h-0 overflow-y-auto">
              {visible.map((s, i) => {
                const isSelected = s.student_id === selectedId;
                const afterSelected = i > 0 && visible[i - 1].student_id === selectedId;
                return (
                  <li key={s.student_id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => openStudent(s.student_id)}
                      className={`flex h-14 w-full cursor-pointer items-center px-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-primary ${gap} ${
                        isSelected
                          ? "rounded-field border-[2.5px] border-brand-gold bg-brand-gold-soft"
                          : `border-t hover:bg-surface-canvas ${afterSelected ? "border-transparent" : "border-border-subtle"}`
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-[10px]">
                        <Avatar name={s.display_name} />
                        <span className="truncate text-label-14 text-ink-primary">{s.display_name}</span>
                        {isSelected && <Pill>Viewing</Pill>}
                      </span>
                      <span className="w-[200px] truncate text-body-14 text-ink-secondary max-md:hidden">
                        {s.program_name}
                      </span>
                      <span className="w-[150px] truncate text-body-14 text-ink-primary max-sm:hidden">
                        {s.credits_earned}
                        <span className="text-ink-secondary"> · {s.credits_in_progress} in progress</span>
                      </span>
                      <span className="flex w-[124px] items-center">
                        <RiskChip
                          level={s.risk_level}
                          detail={s.risk_score === null ? undefined : `· ${points(s.risk_score)}`}
                        />
                      </span>
                      <Image src="/advisor/chevron-right.svg" alt="" width={16} height={16} className="flex-none" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {caseload.status === "ready" && (
          <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-2">
            <p className="text-caption-12-regular text-ink-secondary">
              Showing {visible.length} of {caseload.total}
            </p>
            <Tag>{open ? "Risk score is advisory only" : "Risk score is advisory only · it never blocks a plan"}</Tag>
          </div>
        )}

        {selected && (
          <StudentPanel
            row={selected}
            detail={detail}
            onRetry={() => openStudent(selected.student_id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </main>
  );
}
