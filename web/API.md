# TasselTrak API (for the frontend)

All routes return JSON. Errors are `{ "error": "..." }` with a 4xx/5xx status. No auth in the demo: pass `advisorId` (1 = Dana Whitfield, 2 = Marcus Okafor).
Numbers are real numbers (credits, counts) except `course_demand`-style fields from `/api/demand`, which are ints.

| Route | Use |
|---|---|
| `GET /api/advisors` | advisor picker |
| `GET /api/caseload?advisorId=1` | `{ students[], summary }`. Each student: `student_id, display_name, external_id, program_name, credits_earned, credits_in_progress, open_flags, top_flag_severity (high/medium/low/null), risk_score (0..1 or null), risk_level (low/medium/high or null), target_credits, plan_id, plan_status (draft/in_review/approved/null)` |
| `GET /api/students/:id` | `{ student, completed[], remaining[], flags[], plans[], notes[], risk }`. `remaining[]` has `eligible`, `critical_path`, `depth`, `group_label`, `pick_count`. `risk` is the risk object (below) or `null` if scores have not been computed. |
| `POST /api/students/:id/plan` `{advisorId}` | generate an AI draft (a few seconds; falls back to rules after about 48 s). Returns the full plan object (below). Older drafts are archived. |
| `GET /api/plans/:id` | full plan object |
| `GET /api/plans/:id/alternatives?itemId=` | swap choices: `{ alternatives: [{courseId, code, title, credits, category, criticalPath, depth, seatsOpen, isSlot}] }` |
| `PUT /api/plans/:id/items/:itemId` `{courseId, reason?, advisorId, dryRun?, force?}` | swap a course. `dryRun:true` = "re-check prerequisites" only, returns `{eligible, missing[], section, problems[], blocking}`. Real swap returns the plan. Blocking problems -> **422** `{problems[], missing[]}` unless `force:true` (logged as an override). |
| `POST /api/plans/:id/items` `{courseId, reason?, advisorId, dryRun?, force?}` | add a course (same checks) |
| `DELETE /api/plans/:id/items/:itemId?advisorId=` | remove a course |
| `POST /api/plans/:id/approve` `{advisorId, override?, note?}` | re-validates, then approves. Blocking issues -> **409** `{issues[]}` unless `override:true`. |
| `PATCH /api/plans/:id` `{rationale?, name?}` | edit text |
| `GET /api/demand?term=spring-2027` | seat-demand panel: `courses[]` with `planned_students, seats_open, seat_shortfall, status (over/tight/ok)`. Requirement slots (GEP/ELEC) are excluded. |
| `POST /api/admin/pregenerate?secret=ADMIN_SECRET&limit=1` | pre-generate drafts for students with no plan; repeat until `remaining: 0`. Add `&redo=fallback` to regenerate drafts that fell back to the rule planner. |
| `POST /api/admin/refresh-risk[?studentId=4]` | start the Databricks job that recomputes risk scores and writes them to Neon. With `studentId` only that student's row is rewritten (400 if not a number); without it, all students. If a run is already active, that run is returned even if its scope differs. Returns `{ run_id, status: "running", already_running? }`. If a run is already active it returns that run instead of starting another. Needs `?secret=ADMIN_SECRET`, or no secret when `REFRESH_PUBLIC=1`. 403 if not allowed, 503 if not configured, 502 if Databricks errors. |
| `GET /api/admin/refresh-risk?run_id=` | poll a refresh run: `{ run_id, status (running/succeeded/failed), life_cycle_state, result_state, message }`. Same auth as above. A run takes about 1 to 3 minutes. When `status` is `succeeded`, refetch `/api/caseload`. |

## Plan object
```
{ plan: { id, studentId, studentName, programName, status (draft|in_review|approved), createdBy, modelName,
          rationale, approvedAt, approvedBy, createdAt, updatedAt },
  term: { code, name },
  items: [{ id, courseId, code, title, credits, reason, source (ai|advisor),
            section: { id, crn, section_code, modality, days[], start_time, end_time, seats_open, capacity, instructor } | null,
            issues: [{ type, severity, message }] }],
  totals: { credits, target, courses },
  issues: [...plan-level issues],            // time conflicts, too many/few credits
  blocking: <count of high-severity issues>,
  canApprove: boolean,
  events: [{ actor_type, action, detail, created_at, advisor_name }] }   // audit trail
```
Issue types: `not_eligible, already_completed, no_section, seat_full, seat_risk, time_conflict, credits_over, credits_under, not_in_program`. Severity `high` blocks approval.

## Risk object (`risk` on `GET /api/students/:id`)
```
{ risk_score: 0.456,            // 0..1
  risk_level: "medium",         // low (< 0.25) | medium (< 0.50) | high
  model_version: "weighted-v1",
  computed_at: "2026-10-10T20:12:31.429Z",
  factors: {                    // the "why": one entry per factor
    open_flags:     { raw: { count: 2, severity_points: 2 }, score: 1,     weight: 0.30, contribution: 0.3 },
    non_passing:    { raw: { unresolved_count: 1 },          score: 0.5,   weight: 0.25, contribution: 0.125 },
    pace_shortfall: { raw: { earned_credits: 42, expected_credits: 30 }, score: 0, weight: 0.20, contribution: 0 },
    gpa_decline, retakes, work_hours, load_vs_target   // same shape
  } }
```
- `risk_score = sum of contribution` over the factors. `score` is the factor normalized to 0..1, `contribution = score * weight`.
- `factors` is free-form JSON: the keys are factor names and the `raw` shape differs per factor. Render it as a "why this score" list sorted by `contribution` (highest first); hide or mute factors with `contribution` 0.
- `risk` is `null` (and caseload `risk_score`/`risk_level` are `null`) until the Databricks job has run.
- The score is **advisory only**. It informs a conversation and never restricts enrollment or blocks a plan. It uses no demographic features. All students are synthetic, so no accuracy is claimed. Show a short note like this near the score.

Notes
- `GEP ...` / `ELEC ...` items are requirement slots (no section). The advisor swaps them for a real class.
- Any advisor edit sets the plan back to `in_review` and clears an earlier approval.
- If the AI model fails or times out, the plan is built by rules and `modelName` is `rules-fallback` (the rationale says so).
- Risk scores are precomputed in Neon by a Databricks notebook (`notebooks/01_risk_scores.py`, run as a Databricks Job). Reads never depend on Databricks being up. The refresh route only triggers a recompute.
- Env: `DATABASE_URL`, `ADMIN_SECRET`, and an LLM: `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` (free Gemini or Groq, tried first) and/or `ANTHROPIC_API_KEY` (Claude, backup). `LLM_PROVIDER=compat|anthropic` puts one first. Optional `PLAN_TERM` (default `spring-2027`).
- Env for risk refresh: `DATABASE_URL_UNPOOLED` (direct Neon string, sent to the job), `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_JOB_ID`. Optional `REFRESH_PUBLIC=1` lets the in-app button call the refresh route without the secret (demo only). These are server-side only and are never returned by the API.
