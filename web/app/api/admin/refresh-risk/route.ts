import { ok, fail, serverError } from "@/lib/api";

export const maxDuration = 30;

// POST /api/admin/refresh-risk[?secret=...][&studentId=4]
//   Starts the Databricks job that recomputes student risk scores and writes them to Neon.
//   With studentId it only rewrites that student's row; without it, all students.
//   If a run is already active it returns that run instead of starting another.
// GET  /api/admin/refresh-risk?run_id=123[&secret=...]
//   Returns { status: "running" | "succeeded" | "failed" } for that run.
//
// Auth: ?secret=ADMIN_SECRET, or set REFRESH_PUBLIC=1 to let the in-app button call it with
// no secret (demo only: synthetic data, one run at a time). The Databricks token and the Neon
// string stay on the server and are never returned.

function allowed(u: URL) {
  if (process.env.REFRESH_PUBLIC === "1") return true;
  return !!process.env.ADMIN_SECRET && u.searchParams.get("secret") === process.env.ADMIN_SECRET;
}

function configured() {
  return !!(
    process.env.DATABRICKS_HOST &&
    process.env.DATABRICKS_TOKEN &&
    process.env.DATABRICKS_JOB_ID &&
    process.env.DATABASE_URL_UNPOOLED
  );
}

function dbx(path: string, init?: RequestInit) {
  const host = (process.env.DATABRICKS_HOST ?? "").replace(/\/$/, "");
  const base = host.startsWith("http") ? host : `https://${host}`;
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.DATABRICKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  if (!allowed(u)) return fail("Forbidden", 403);
  if (!configured()) return fail("Risk refresh is not configured", 503);
  const sid = u.searchParams.get("studentId"); // optional: refresh one student, default all
  if (sid !== null && !/^\d+$/.test(sid)) return fail("studentId must be a number", 400);
  try {
    const jobId = Number(process.env.DATABRICKS_JOB_ID);

    const active = await dbx(`/api/2.2/jobs/runs/list?job_id=${jobId}&active_only=true&limit=1`);
    if (!active.ok) return fail(`Databricks error ${active.status}`, 502);
    const a = await active.json();
    if (a.runs?.length) {
      return ok({ run_id: a.runs[0].run_id, status: "running", already_running: true });
    }

    const res = await dbx("/api/2.2/jobs/run-now", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        job_parameters: {
          NEON_URL: process.env.DATABASE_URL_UNPOOLED,
          STUDENT_ID: sid ?? "all",
        },
      }),
    });
    if (!res.ok) return fail(`Databricks error ${res.status}`, 502);
    const j = await res.json();
    return ok({ run_id: j.run_id, status: "running" });
  } catch (e) {
    return serverError(e);
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (!allowed(u)) return fail("Forbidden", 403);
  if (!configured()) return fail("Risk refresh is not configured", 503);
  const runId = Number(u.searchParams.get("run_id"));
  if (!runId) return fail("run_id is required", 400);
  try {
    const res = await dbx(`/api/2.2/jobs/runs/get?run_id=${runId}`);
    if (!res.ok) return fail(`Databricks error ${res.status}`, 502);
    const j = await res.json();
    const life: string | undefined = j.state?.life_cycle_state;
    const result: string | undefined = j.state?.result_state;
    const done = ["TERMINATED", "SKIPPED", "INTERNAL_ERROR"].includes(life ?? "");
    const status = !done ? "running" : result === "SUCCESS" ? "succeeded" : "failed";
    return ok({
      run_id: runId,
      status,
      life_cycle_state: life ?? null,
      result_state: result ?? null,
      message: j.state?.state_message ?? null,
    });
  } catch (e) {
    return serverError(e);
  }
}
