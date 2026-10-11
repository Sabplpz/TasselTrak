// Every API call the plan canvas makes lives here, with the shapes it relies on and the one table
// that turns API error codes into plain language. If a route changes, this is the only file that
// needs fixing. Routes and shapes follow web/API.md ("Plans").

// ---------------------------------------------------------------- shapes

// `courseId` and `code` name the course a problem belongs to; a plan-level problem has neither.
// `overridden` problems no longer block approval.
export type PlanIssue = {
  type: string;
  severity: "high" | "medium" | "low";
  message: string;
  courseId?: number;
  code?: string;
  overridden?: boolean;
};

export type TermRef = { code: string; name: string };

// One column of the board. Completed and current terms hold `history`, planned terms hold `items`.
export type PlanTerm = TermRef & {
  state: "completed" | "current" | "planned";
  now: boolean;
  label: string; // "Completed" | "In progress" | "Up next" | "Later"
  credits: number;
  courses: number;
};

export type HistoryCourse = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  grade: string | null;
  status: "taken" | "in_progress" | "not_passed";
  termCode: string | null;
};

export type PlanItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  credits: number;
  termCode: string;
  termName: string;
  reason: string | null;
  source: "ai" | "advisor" | "student";
  suggested: boolean; // proposed by the planner and not confirmed yet
  fills: string | null;
  status: "available" | "needs" | "locked";
  needs: string[]; // what it is waiting on, one entry per prerequisite group
  section: {
    section_code: string | null;
    modality: string | null;
    days: string[] | null;
    start_time: string | null;
    end_time: string | null;
    capacity: number | null;
    seats_open: number | null;
    instructor: string | null;
  } | null;
  issues: PlanIssue[];
  // set once an advisor approved the course despite a blocking problem
  override: { advisorName: string | null; at: string; note: string } | null;
};

// The "plan object": returned by GET /api/plans/:id and by every route that changes a plan.
export type PlanResponse = {
  plan: {
    id: number;
    studentId: number;
    studentName: string;
    programName: string | null;
    status: "draft" | "in_review" | "approved" | "archived";
    createdBy: "ai" | "advisor";
    modelName: string | null;
    rationale: string | null;
    rationalePoints: string[] | null;
    approvedAt: string | null;
    approvedBy: string | null; // the advisor's name
    updatedAt: string;
  };
  term: TermRef; // the first planned term
  terms: PlanTerm[];
  history: HistoryCourse[];
  items: PlanItem[];
  totals: { credits: number; target: number; courses: number; byTerm: { code: string; credits: number }[] };
  issues: PlanIssue[];
  blockingIssues: PlanIssue[]; // each problem that blocks approval, once
  canApprove: boolean; // the plan has courses and nothing blocks it
  readOnly: boolean; // approved plans cannot be edited until they are reopened
};

// GET /api/plans/:id/course-options?term=
export type CourseOption = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  category: string | null;
  criticalPath: boolean;
  prerequisitesMet: boolean; // judged for the requested term
  missing: string[];
};
export type CourseOptions = {
  term: TermRef & { open: boolean };
  groups: { requirement: string; fills: string | null; courses: CourseOption[] }[];
};

// GET /api/plans/:id/prerequisites
export type Prerequisite = {
  courseCode: string;
  requiredCode: string;
  kind: "prereq" | "coreq";
  groupNo: number;
  minGrade: string | null;
};

// GET /api/plans/:id/courses/:courseId/alternatives
export type Alternative = { courseId: number; code: string; title: string; credits: number; criticalPath: boolean };

// GET /api/plans/:id/courses/:courseId/dependents
export type Dependent = { courseId: number; code: string; title: string; termName: string; direct: boolean };

// ---------------------------------------------------------------- errors

// What each API error code means, in plain language. Codes come from `{ error, code }` bodies.
// `check_failed` is not here: its message is built from the API's own `problems`.
const MESSAGES: Record<string, string> = {
  // not found
  plan_not_found: "This plan no longer exists.",
  item_not_found: "That course is no longer in this plan.",
  course_not_found: "That course could not be found.",
  student_not_found: "This student could not be found.",
  program_not_found: "That major could not be found.",
  term_not_found: "That term isn’t available for planning.",
  no_plan: "This student doesn’t have a plan yet.",
  no_program: "Pick a major first.",
  // the plan can't be edited right now
  read_only: "This plan is approved and read-only. Reopen it to make changes.",
  archived: "This plan was replaced by a newer draft. Open the student’s current plan to make changes.",
  // undo
  nothing_to_restore: "There is nothing to undo for that course.",
  already_in_plan: "That course is already back in the plan.",
  // generating a draft
  plan_exists: "This student already has a plan.",
  plan_approved: "This plan is approved. Reopen it before generating a new draft.",
  planner_timeout: "The planner timed out before it finished, so nothing on the board changed.",
  planner_failed: "The planner couldn’t finish the draft, so nothing on the board changed.",
  no_candidates: "There are no eligible courses with open sections to build a draft from.",
  cancelled: "Generating the draft was cancelled. Nothing was changed.",
  // overrides and approval
  not_authorized: "You aren’t authorized to override problems on a plan.",
  advisor_required: "Sign in as an advisor to do that.",
  note_required: "A written reason is needed to override a problem.",
  nothing_to_override: "That course has no problem to override.",
  blocking_issues: "This plan still has problems that block approval.",
  already_approved: "This plan is already approved.",
  empty_plan: "This plan has no courses yet.",
  invalid_status: "The plan isn’t in the right state for that.",
  // ours, for failures that never reached the API
  invalid_request: "That request wasn’t valid.",
  invalid_grade: "One of the grades isn’t a grade we recognise.",
  server_error: "The server ran into a problem.",
  timeout: "The server took too long to answer.",
  offline: "The connection dropped.",
  unreadable: "The server sent a response we couldn’t read.",
};

type ErrorBody = {
  error?: string;
  code?: string;
  problems?: PlanIssue[];
  suggestedTerm?: TermRef | null;
  planId?: number;
  status?: PlanResponse["plan"]["status"];
};

// A request the API refused or could not complete. `message` is plain language, ready to show.
export class PlanApiError extends Error {
  code: string;
  // check_failed: the earliest later term where the change would be allowed, if there is one
  suggestedTerm: TermRef | null;
  // plan_exists / plan_approved: the plan that is in the way
  existing: { planId: number; status: PlanResponse["plan"]["status"] } | null;

  constructor(code: string, body: ErrorBody = {}) {
    const blocking = (body.problems ?? []).filter((p) => p.severity === "high");
    const shown = blocking.length > 0 ? blocking : (body.problems ?? []);
    super(
      code === "check_failed" && shown.length > 0
        ? shown.map((p) => p.message).join(" ")
        : (MESSAGES[code] ?? MESSAGES.server_error),
    );
    this.code = code;
    this.suggestedTerm = body.suggestedTerm ?? null;
    this.existing = body.planId ? { planId: body.planId, status: body.status ?? "draft" } : null;
  }
}

// Plain-language reason for any failure from this file.
export const explain = (e: unknown) => (e instanceof PlanApiError ? e.message : MESSAGES.server_error);
export const codeOf = (e: unknown) => (e instanceof PlanApiError ? e.code : "server_error");

export async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: object,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch {
    throw new PlanApiError(options.signal?.aborted ? "cancelled" : timeout.aborted ? "timeout" : "offline");
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // handled below: an unreadable body is only acceptable on a failure
  }
  if (!res.ok) {
    const failure = (parsed ?? {}) as ErrorBody;
    throw new PlanApiError(failure.code ?? "server_error", failure);
  }
  if (parsed === null) throw new PlanApiError("unreadable");
  return parsed as T;
}

// ---------------------------------------------------------------- reading

// GET /api/plans/:id -> plan object. 404 plan_not_found.
export const getPlan = (planId: string | number) => request<PlanResponse>("GET", `/api/plans/${planId}`);

// GET /api/plans/:id/prerequisites -> prerequisite edges for the student's program.
export async function getPrerequisites(planId: number) {
  return (await request<{ prerequisites: Prerequisite[] }>("GET", `/api/plans/${planId}/prerequisites`)).prerequisites;
}

// GET /api/plans/:id/course-options?term= -> what can still be added to that term. 404 term_not_found.
export const getCourseOptions = (planId: number, termCode: string) =>
  request<CourseOptions>("GET", `/api/plans/${planId}/course-options?term=${encodeURIComponent(termCode)}`);

// GET /api/students/:id -> the two things the plan object does not carry: the expected graduation
// term for the top bar, and how deep each remaining course sits in its prerequisite chain.
export async function getStudentExtras(studentId: number) {
  const body = await request<{
    student: { expected_graduation: string | null };
    remaining: { course_id: number; depth: number; critical_path: boolean }[];
  }>("GET", `/api/students/${studentId}`);
  return {
    expectedGraduation: body.student.expected_graduation,
    depth: new Map(body.remaining.map((r) => [r.course_id, r.depth])),
    critical: new Set(body.remaining.filter((r) => r.critical_path).map((r) => r.course_id)),
  };
}
export type StudentExtras = Awaited<ReturnType<typeof getStudentExtras>>;

// GET /api/plans/:id/courses/:courseId/alternatives -> courses that could replace this one.
export async function getAlternatives(planId: number, courseId: number) {
  const body = await request<{ alternatives: Alternative[] }>("GET", `/api/plans/${planId}/courses/${courseId}/alternatives`);
  return body.alternatives;
}

// GET /api/plans/:id/courses/:courseId/dependents -> planned courses that stop being valid if this one leaves.
export async function getDependents(planId: number, courseId: number) {
  const body = await request<{ dependents: Dependent[] }>("GET", `/api/plans/${planId}/courses/${courseId}/dependents`);
  return body.dependents;
}

// ---------------------------------------------------------------- changing a plan
// Each returns the updated plan object. 422 check_failed when the checks block the change,
// 409 read_only on an approved plan.

// POST /api/plans/:id/courses { courseId, termCode, advisorId }
export const addCourse = (planId: number, courseId: number, termCode: string, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/courses`, { courseId, termCode, advisorId });

// PATCH /api/plans/:id/courses/:courseId { termCode, advisorId } -> move to another term
export const moveCourse = (planId: number, courseId: number, termCode: string, advisorId: number) =>
  request<PlanResponse>("PATCH", `/api/plans/${planId}/courses/${courseId}`, { termCode, advisorId });

// PUT /api/plans/:id/courses/:courseId { newCourseId, advisorId } -> swap, in the same term
export const swapCourse = (planId: number, courseId: number, newCourseId: number, advisorId: number) =>
  request<PlanResponse>("PUT", `/api/plans/${planId}/courses/${courseId}`, { newCourseId, advisorId });

// DELETE /api/plans/:id/courses/:courseId?advisorId=
export const removeCourse = (planId: number, courseId: number, advisorId: number) =>
  request<PlanResponse>("DELETE", `/api/plans/${planId}/courses/${courseId}?advisorId=${advisorId}`);

// POST /api/plans/:id/courses/:courseId/restore -> undo a remove. 404 nothing_to_restore.
export const restoreCourse = (planId: number, courseId: number, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/courses/${courseId}/restore`, { advisorId });

// POST /api/plans/:id/courses/:courseId/confirm -> a suggested course becomes confirmed
export const confirmCourse = (planId: number, courseId: number, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/courses/${courseId}/confirm`, { advisorId });

// ---------------------------------------------------------------- review and approval
// Each returns the updated plan object.

// POST /api/plans/:id/approve { advisorId } -> approved and read-only. 409 blocking_issues while
// problems remain, 409 already_approved / empty_plan. With `overrideNote` it also overrides every
// remaining blocking problem: 403 not_authorized, 400 note_required.
export const approvePlan = (planId: number, advisorId: number, overrideNote?: string) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/approve`, {
    advisorId,
    ...(overrideNote ? { override: true, note: overrideNote } : {}),
  });

// POST /api/plans/:id/courses/:courseId/override { advisorId, note } -> the course's blocking
// problems stop counting. 403 not_authorized, 400 note_required, 409 nothing_to_override.
export const overrideCourse = (planId: number, courseId: number, advisorId: number, note: string) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/courses/${courseId}/override`, { advisorId, note });

// POST /api/plans/:id/submit-review -> draft to in review. 409 invalid_status / empty_plan.
export const submitForReview = (planId: number, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/submit-review`, { advisorId });

// POST /api/plans/:id/back-to-draft -> in review to draft. 409 invalid_status.
export const backToDraft = (planId: number, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/back-to-draft`, { advisorId });

// POST /api/plans/:id/reopen -> approved to draft; the board can be edited again. 409 invalid_status.
export const reopenPlan = (planId: number, advisorId: number) =>
  request<PlanResponse>("POST", `/api/plans/${planId}/reopen`, { advisorId });

// ---------------------------------------------------------------- generating a draft

// POST /api/students/:id/plan/generate { advisorId, replace } -> 201 plan object for a NEW plan.
// 409 plan_exists { planId, status } unless `replace` is true; 409 plan_approved; 504
// planner_timeout / planner_failed (nothing changed). One request of up to about 50 seconds.
// Aborting `signal` cancels it and the server saves nothing.
export const generatePlan = (studentId: number, advisorId: number, replace: boolean, signal: AbortSignal) =>
  request<PlanResponse>("POST", `/api/students/${studentId}/plan/generate`, { advisorId, replace }, { timeoutMs: 75000, signal });
