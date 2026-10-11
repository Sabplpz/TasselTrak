// Every API call the plan canvas makes lives here, with the shapes it relies on. If a route
// changes, this is the only file that needs fixing.
import { FetchError, getJson } from "@/lib/fetchJson";

// ---------------------------------------------------------------- shapes

export type PlanIssue = { type: string; severity: "high" | "medium" | "low"; message: string };

export type PlanItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  credits: number;
  reason: string | null;
  source: "ai" | "advisor";
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
};

// The "plan object" returned by GET /api/plans/:id and by every route that changes a plan.
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
    updatedAt: string;
  };
  term: { code: string; name: string };
  items: PlanItem[];
  totals: { credits: number; target: number; courses: number };
  issues: PlanIssue[];
};

export type RemainingCourse = {
  course_id: number;
  code: string;
  title: string;
  credits: number;
  category: string | null;
  group_label: string | null;
  pick_count: number | null;
  critical_path: boolean;
  depth: number;
  eligible: boolean;
};

// GET /api/students/:id (the parts the board reads)
export type StudentResponse = {
  student: { expected_graduation: string | null };
  completed: {
    code: string;
    title: string;
    credits: number;
    grade: string | null;
    term: string | null;
    in_progress: boolean;
  }[];
  remaining: RemainingCourse[];
};

// GET /api/plans/:id/prerequisites
export type Prerequisite = {
  courseCode: string;
  requiredCode: string;
  kind: "prereq" | "coreq";
  groupNo: number;
  minGrade: string | null;
};

// GET /api/plans/:id/alternatives
export type Alternative = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  category: string | null;
  criticalPath: boolean;
  isSlot: boolean;
  seatsOpen: number | null;
};

// POST /api/plans/:id/items with dryRun: the checks, without changing anything
export type CourseCheck = {
  eligible: boolean;
  missing: string[]; // one entry per unmet prerequisite group, e.g. "COP 3502C" or "MAC 2311C or MAC 2281"
  problems: PlanIssue[];
  blocking: boolean;
};

export type PlanBoardData = { plan: PlanResponse; student: StudentResponse; prerequisites: Prerequisite[] };

// ---------------------------------------------------------------- errors

// A change the API refused or could not make. `message` is plain language, ready to show.
export class PlanApiError extends Error {
  problems: PlanIssue[];
  constructor(message: string, problems: PlanIssue[] = []) {
    super(message);
    this.problems = problems;
  }
}

// Server error texts that are already written for people. Anything else gets a general message,
// so raw database or runtime errors never reach the page.
const READABLE: Record<string, string> = {
  "Plan not found": "This plan no longer exists.",
  "Plan item not found": "That course is no longer in the plan.",
  "Course not found": "That course could not be found.",
  "Student not found": "This student could not be found.",
  "No eligible courses with sections next term": "There are no eligible courses with open sections next term.",
  "Could not build a plan from the eligible courses": "The planner could not build a plan from the eligible courses.",
};

function refusal(body: { error?: string; problems?: PlanIssue[] }): PlanApiError {
  const problems = body.problems ?? [];
  const blocking = problems.filter((p) => p.severity === "high");
  const shown = blocking.length > 0 ? blocking : problems;
  if (shown.length > 0) return new PlanApiError(shown.map((p) => p.message).join(" "), problems);
  return new PlanApiError(READABLE[body.error ?? ""] ?? "The server ran into a problem.");
}

async function send<T>(method: "POST" | "PUT" | "DELETE", url: string, body?: object, timeoutMs = 20000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new PlanApiError(timedOut ? "The server took too long to answer." : "The connection dropped.");
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // handled below: an unreadable body is only acceptable on a failure
  }
  if (!res.ok) throw refusal((parsed ?? {}) as { error?: string; problems?: PlanIssue[] });
  if (parsed === null) throw new PlanApiError("The server sent a response we couldn’t read.");
  return parsed as T;
}

// Plain-language reason for any failure from this file.
export function explain(e: unknown): string {
  if (e instanceof PlanApiError) return e.message;
  if (e instanceof FetchError) return `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}.`;
  return "Something went wrong.";
}

// True when the plan itself is gone (the page shows "plan not found" instead of an error).
export const isMissing = (e: unknown) => e instanceof FetchError && e.status === 404;

// ---------------------------------------------------------------- calls

// Everything the board needs: the plan, the student's transcript and remaining requirements, and
// the prerequisite edges. Throws FetchError (see isMissing).
export async function loadBoard(planId: string | number): Promise<PlanBoardData> {
  const plan = await getJson<PlanResponse>(`/api/plans/${planId}`);
  const [student, edges] = await Promise.all([
    getJson<StudentResponse>(`/api/students/${plan.plan.studentId}`),
    getJson<{ prerequisites: Prerequisite[] }>(`/api/plans/${planId}/prerequisites`),
  ]);
  return { plan, student, prerequisites: edges.prerequisites };
}

// POST /api/plans/:id/items { courseId, dryRun: true } -> would this course be allowed? Changes nothing.
export function checkCourse(planId: number, courseId: number) {
  return send<CourseCheck>("POST", `/api/plans/${planId}/items`, { courseId, dryRun: true });
}

// POST /api/plans/:id/items { courseId, advisorId } -> 201 plan object. 422 { problems, missing } if blocked.
export function addCourse(planId: number, courseId: number, advisorId: number) {
  return send<PlanResponse>("POST", `/api/plans/${planId}/items`, { courseId, advisorId });
}

// PUT /api/plans/:id/items/:itemId { courseId, advisorId } -> plan object. 422 { problems, missing } if blocked.
export function swapCourse(planId: number, itemId: number, courseId: number, advisorId: number) {
  return send<PlanResponse>("PUT", `/api/plans/${planId}/items/${itemId}`, { courseId, advisorId });
}

// DELETE /api/plans/:id/items/:itemId?advisorId= -> plan object. 404 if the item is already gone.
export function removeCourse(planId: number, itemId: number, advisorId: number) {
  return send<PlanResponse>("DELETE", `/api/plans/${planId}/items/${itemId}?advisorId=${advisorId}`);
}

// GET /api/plans/:id/alternatives?itemId= -> courses the student could take instead of this item.
export async function getAlternatives(planId: number, itemId: number) {
  const body = await getJson<{ alternatives: Alternative[] }>(`/api/plans/${planId}/alternatives?itemId=${itemId}`);
  return body.alternatives;
}

// POST /api/students/:id/plan { advisorId } -> 201 plan object for a NEW plan (new id). The
// student's draft and in-review plans are archived. Takes a few seconds, up to about a minute.
export function generatePlan(studentId: number, advisorId: number) {
  return send<PlanResponse>("POST", `/api/students/${studentId}/plan`, { advisorId }, 75000);
}
