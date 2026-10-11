// Client for the student routes. Shares `request` and its plain-language errors with planApi.
import { request } from "@/lib/planApi";

// The student row a signed-in account is linked to.
export type Student = { id: number; name: string; programId: number | null; programName: string | null };

// Row from GET /api/programs
export type Program = {
  id: number;
  name: string;
  degreeType: string | null;
  catalogYear: number;
  totalCredits: number;
  courses: number;
};

export type ProgramCourse = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  category: string;
  groupLabel: string | null;
  criticalPath: boolean;
  isSlot: boolean; // a requirement slot such as "GEP HUM1": a course from that group
  inProgram: boolean; // false for a prerequisite that is not a requirement of the major itself
};

// One requirement of a major. `pickCount` is how many of `courses` it needs; null means all.
export type ProgramGroup = { requirement: string; category: string; pickCount: number | null; courses: ProgramCourse[] };

// Row from GET /api/students/:id/completed-courses
export type HistoryCourse = {
  courseId: number;
  code: string;
  title: string;
  credits: number;
  grade: string | null;
  status: "taken" | "in_progress" | "not_passed";
  termCode: string | null;
};

// Row of the PUT body. A taken course with no grade is saved as "P".
export type HistoryEntry = { courseId: number; status?: "taken" | "in_progress"; grade?: string | null; termCode?: string | null };

// POST /api/students/login { studentId } or { email } -> the student row, and "upload" when
// nothing is on file yet or "board" otherwise. 404 student_not_found.
export const loginStudent = (by: { studentId: number } | { email: string }) =>
  request<{ student: Student; next: "upload" | "board" }>("POST", "/api/students/login", by);

// GET /api/programs -> the majors.
export async function getPrograms() {
  return (await request<{ programs: Program[] }>("GET", "/api/programs")).programs;
}

// GET /api/programs/:id/courses -> the major's courses by requirement. 404 program_not_found.
export async function getProgramCourses(programId: number) {
  return (await request<{ groups: ProgramGroup[] }>("GET", `/api/programs/${programId}/courses`)).groups;
}

// GET /api/students/:id/completed-courses -> what is on file for the student.
export async function getHistory(studentId: number) {
  return (await request<{ courses: HistoryCourse[] }>("GET", `/api/students/${studentId}/completed-courses`)).courses;
}

// PUT /api/students/:id/completed-courses { programId, courses } -> saves the major and makes
// `courses` the student's whole history, in one statement.
export const saveHistory = (studentId: number, programId: number, courses: HistoryEntry[]) =>
  request<{ saved: number; programId: number | null; credits: { earned: number; inProgress: number } }>(
    "PUT",
    `/api/students/${studentId}/completed-courses`,
    { programId, courses },
  );
