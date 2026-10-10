# TasselTrak API (for the frontend)

All routes return JSON. Errors are `{ "error": "..." }` with a 4xx/5xx status. No auth in the demo: pass `advisorId` (1 = Dana Whitfield, 2 = Marcus Okafor).
Numbers are real numbers (credits, counts) except `course_demand`-style fields from `/api/demand`, which are ints.

| Route | Use |
|---|---|
| `GET /api/advisors` | advisor picker |
| `GET /api/caseload?advisorId=1` | `{ students[], summary }`. Each student: `student_id, display_name, external_id, program_name, credits_earned, credits_in_progress, open_flags, top_flag_severity (high/medium/low/null), risk_score, risk_level, target_credits, plan_id, plan_status (draft/in_review/approved/null)` |
| `GET /api/students/:id` | `{ student, completed[], remaining[], flags[], plans[], notes[], risk }`. `remaining[]` has `eligible`, `critical_path`, `depth`, `group_label`, `pick_count` |
| `POST /api/students/:id/plan` `{advisorId}` | generate an AI draft (10-40 s with Qwen). Returns the full plan object (below). Older drafts are archived. |
| `GET /api/plans/:id` | full plan object |
| `GET /api/plans/:id/alternatives?itemId=` | swap choices: `{ alternatives: [{courseId, code, title, credits, category, criticalPath, depth, seatsOpen, isSlot}] }` |
| `PUT /api/plans/:id/items/:itemId` `{courseId, reason?, advisorId, dryRun?, force?}` | swap a course. `dryRun:true` = "re-check prerequisites" only, returns `{eligible, missing[], section, problems[], blocking}`. Real swap returns the plan. Blocking problems -> **422** `{problems[], missing[]}` unless `force:true` (logged as an override). |
| `POST /api/plans/:id/items` `{courseId, reason?, advisorId, dryRun?, force?}` | add a course (same checks) |
| `DELETE /api/plans/:id/items/:itemId?advisorId=` | remove a course |
| `POST /api/plans/:id/approve` `{advisorId, override?, note?}` | re-validates, then approves. Blocking issues -> **409** `{issues[]}` unless `override:true`. |
| `PATCH /api/plans/:id` `{rationale?, name?}` | edit text |
| `GET /api/demand?term=spring-2027` | seat-demand panel: `courses[]` with `planned_students, seats_open, seat_shortfall, status (over/tight/ok)`. Requirement slots (GEP/ELEC) are excluded. |
| `POST /api/admin/pregenerate?secret=ADMIN_SECRET&limit=2` | pre-generate drafts for students with no plan; repeat until `remaining: 0` |

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

Notes
- `GEP ...` / `ELEC ...` items are requirement slots (no section). The advisor swaps them for a real class.
- Any advisor edit sets the plan back to `in_review` and clears an earlier approval.
- If the AI model fails or times out, the plan is built by rules and `modelName` is `rules-fallback` (the rationale says so).
- Env: `DATABASE_URL`, `HF_TOKEN`, `HF_MODEL_ID`, `ADMIN_SECRET`; optional `PLAN_TERM` (default `spring-2027`).
