# TasselTrak API (for the frontend)

All routes return JSON. Errors are `{ "error": "message", "code": "machine_code", ...extras }` with a 4xx/5xx status; switch on `code`, not on the message.
No auth in the demo: advisor routes take `advisorId` (query or body). Numbers are real numbers; risk scores are integers 0..100.
Term codes look like `spring-2027`, `fall-2026` (the same codes as the `terms` table).

Run `migrations/003_figma_alignment.sql` after 001 and 002. It is safe to re-run.

## Advisor dashboard

| Route | Use |
|---|---|
| `GET /api/advisors` | advisor picker: `{ advisors: [{ id, name, email, department, can_override, students }] }` |
| `GET /api/advisors/:advisorId/students?search=&major=&sort=risk_desc&limit=10&offset=0` | **A1 student list.** `sort`: `risk_desc` (default), `risk_asc`, `name`. `major` is an exact program name. Returns `{ advisor, summary: { total, high_risk }, majors[], page: { limit, offset, total }, students[] }`. Each student: `student_id, display_name, program_name, class_standing, credits_earned, credits_in_progress, credits_remaining, gpa, projected_graduation, open_flags, top_flag_severity, risk_score (0..100 or null), risk_level, plan_id, plan_status, sample`. `summary` covers the advisor's whole caseload, ignoring search and filters. |
| `GET /api/students/:id/risk` | **A2 side panel.** `{ status, student, risk_score, risk_level, model_version, computed_at, summary, factors[], advisory_note, sample }`. `status`: `ok`, `no_audit` (student has no courses on file: show "Send a reminder"), `not_computed` (risk job has not run). Each factor: `{ key, title, detail, points }`, highest first, zero-contribution factors left out. |
| `POST /api/students/:id/remind` `{advisorId}` | "Send a reminder". There is no email service in the demo: it saves an advisor note and returns `{ recorded: true, delivered: false }`. |
| `GET /api/caseload?advisorId=1` | older list, unchanged (no GPA, raw 0..1 risk) |
| `GET /api/students/:id` | older detail screen payload, unchanged (risk is still the raw 0..1 object, below) |

Risk level cut-offs (0..100): `low` < 25, `medium` < 50, `high` >= 50. The notebook's own labels use 0.25 / 0.50, so the API recomputes the level from the score. Change with env `RISK_MEDIUM_AT` / `RISK_HIGH_AT`.
`class_standing` comes from graded credits (<30 Freshman, <60 Sophomore, <90 Junior, else Senior). `gpa` uses the scale in `grade_points()` (migration 003); W, TC, P, S and in-progress grades are left out.

## Plans

| Route | Use |
|---|---|
| `GET /api/students/:id/plan` | the student's current plan. **404 `no_plan`** is the "doesn't have a plan yet" state. |
| `POST /api/students/:id/plan/generate` `{advisorId?, replace?, allowFallback?}` | **Generate draft plan.** One request, up to about 50 s. **201** plan. **409 `plan_exists`** `{ planId, status }` when a draft/in-review plan exists and `replace` is not true (the "Open existing plan / Generate a new draft" dialog). **409 `plan_approved`** when the plan is approved (reopen first). **504 `planner_timeout`** / `planner_failed`: the model failed and **nothing was changed** (the "failed" banner). `allowFallback: true` saves a rule-based draft instead of failing (`modelName: "rules-fallback"`). **Cancel link** = abort the fetch (`AbortController`); the server then saves nothing. There is no progress feed: animate the "courses appear one by one" banner on the client and reveal the real plan when the response arrives. |
| `POST /api/students/:id/plan` `{advisorId?}` | older generate route, kept: always writes a draft, falls back to rules, never returns 409. |
| `GET /api/plans/:id` | full plan object (below) |
| `PATCH /api/plans/:id` `{rationale?, name?}` | edit text. 409 `read_only` once approved. |
| `GET /api/plans/:id/course-options?term=spring-2027&search=` | **Add-course picker.** `{ term: { code, name, open, scheduleAvailable }, groups: [{ requirement, fills, courses: [{ courseId, code, title, credits, category, criticalPath, isSlot, prerequisitesMet, missing[], seatsOpen }] }] }`. Courses already on the board, and requirement slots already used, are left out. `prerequisitesMet` is judged for that term. |
| `POST /api/plans/:id/courses` `{courseId, termCode?, reason?, advisorId?, dryRun?, force?, note?}` | add a course (`termCode` defaults to the next term). **201** plan + `added`. **422 `check_failed`** `{ problems[], missing[], blockingCourse, suggestedTerm, term }`: show the reason in place and add nothing. `dryRun: true` runs the checks only. `force: true` adds anyway as an override (needs an authorized advisor, else 403 `not_authorized`). |
| `PATCH /api/plans/:id/courses/:courseId` `{termCode, advisorId?, dryRun?, force?}` | move to another term. 422 `check_failed` carries `suggestedTerm` for "Move to Spring 2027". |
| `PUT /api/plans/:id/courses/:courseId` `{newCourseId, reason?, advisorId?, dryRun?, force?}` | swap for another course in the same term |
| `GET /api/plans/:id/courses/:courseId/alternatives` | swap choices: `{ alternatives: [{ courseId, code, title, credits, category, groupLabel, fills, criticalPath, depth, isSlot, seatsOpen }] }` |
| `POST /api/plans/:id/courses/:courseId/confirm` `{advisorId?}` | "Suggested" becomes confirmed (does not change the plan's status) |
| `GET /api/plans/:id/courses/:courseId/dependents` | **Remove confirmation.** `{ course, dependents: [{ courseId, code, title, termCode, termName, direct, becomes: "blocked" }] }`: courses that stop being valid if this one leaves. `direct: false` means only a knock-on effect. |
| `DELETE /api/plans/:id/courses/:courseId?advisorId=` | remove. Returns the plan + `removed`. |
| `POST /api/plans/:id/courses/:courseId/restore` `{advisorId?}` | **Undo** after a remove (same term, section, reason). 404 `nothing_to_restore` if there is nothing to bring back. Undo after an add is just `DELETE`. |
| `POST /api/plans/:id/courses/:courseId/override` `{advisorId, note}` | **A6a override modal.** 403 `not_authorized`, 400 `note_required`, 409 `nothing_to_override`. The course then carries `override: { advisorName, at, note }` (the A6b hover tag) and its problems stop counting as blocking. |
| `POST /api/plans/:id/approve` `{advisorId}` | **200** approved (read-only; every course still marked Suggested becomes confirmed). **409 `blocking_issues`** `{ blocking, issues[] }` is the A5 checklist; each issue has `courseId` to jump to. 409 `already_approved` / `empty_plan`. `{override: true, note}` is a shortcut that overrides every remaining blocking course at once (403 / 400 as above). |
| `POST /api/plans/:id/submit-review` | draft to in review (sets `submittedAt`) |
| `POST /api/plans/:id/back-to-draft` | in review to draft |
| `POST /api/plans/:id/reopen` | approved to draft (the board is editable again) |
| `GET /api/plans/:id/alternatives?itemId=&term=`, `POST /api/plans/:id/items`, `PUT` / `DELETE /api/plans/:id/items/:itemId` | older item-id routes, kept; they share the same checks as the `/courses` routes |

### Status flow
- **draft**: editable. **Any advisor edit puts the plan back to draft** and clears review/approval.
- **in_review**: waiting on sign-off; still editable. Edits send it back to draft.
- **approved**: read-only. Every edit returns **409 `read_only`** until `reopen`.
- Generating over an approved plan is refused (409 `plan_approved`).

## Plan object
```
{ plan: { id, studentId, studentName, programName, name, status (draft|in_review|approved), createdBy, modelName,
          rationale, rationalePoints[], submittedAt, approvedAt, approvedBy (name), createdAt, updatedAt },
  term: { code, name },                       // first planned term (older clients)
  terms: [{ code, name, state (completed|current|planned), now, label ("Completed"|"In progress"|"Up next"|"Later"),
            credits, courses, scheduleAvailable }],
  history: [{ courseId, code, title, credits, grade, status (taken|in_progress|not_passed), termCode }],
  items: [{ id, courseId, code, title, credits, termCode, termName, reason, source (ai|advisor),
            confirmed, suggested, fills,
            status (available|needs|locked), needs[],         // "Needs COP 3503 +1" = needs.length 2
            section: { id, crn, section_code, modality, days[], start_time, end_time, seats_open, capacity, instructor } | null,
            issues: [{ type, severity, message, courseId, code, termCode, overridden? }],
            override: { advisorId, advisorName, at, note } | null }],
  totals: { credits, target, courses, terms, overrides, byTerm: [{ code, credits }] },
  issues: [...plan-level issues],             // time clashes, credits over/under a term
  blockingIssues: [...],                      // each blocking problem once (the A5 checklist)
  blocking: <count of blockingIssues>, canApprove, readOnly,
  events: [{ actor_type, action, detail, created_at, advisor_name }] }   // audit trail
```
- The board is `history` (taken and in-progress courses, by `termCode`) plus `items` (planned courses, by `termCode`); `terms` gives the column headers.
- `status`: `available` = every prerequisite is passed; `needs` = the missing ones are being taken now (`needs` lists them); `locked` = a missing prerequisite has not started yet.
- A prerequisite counts for a course in term T when it is passed, or in progress / planned in an **earlier** term than T. Taking both in the same term does not count (that is the A4 error).
- Seats and sections are only checked for terms that have a published schedule (`scheduleAvailable`).
- Issue types: `not_eligible, already_completed, already_planned, no_section, seat_full, seat_risk, time_conflict, credits_over, credits_under, not_in_program, term_not_open`. Severity `high` blocks approval unless the course is overridden.
- Only the next term gets a seat-checked, model-chosen draft. Later terms (default one more, env `PLAN_EXTRA_TERMS`) are filled by rules once prerequisites allow.

## Seat demand (A8)

| Route | Use |
|---|---|
| `GET /api/demand?term=spring-2027&sort=shortfall_desc&limit=10&offset=0` | `{ term, terms[], courses[], over, page }`. `terms` fills the term picker. Courses: `planned_students, seats_total, seats_open, seat_shortfall, status (over/tight/ok)`. `sort`: `shortfall_desc`, `planned_desc`, `code`. Requirement slots (GEP/ELEC) are excluded. 404 `term_not_found`. There is no major filter yet (the demand view is not split by program). |
| `GET /api/demand/:courseId/students?term=&limit=8&offset=0` | side panel: `{ course, term, total, students: [{ student_id, display_name, program_name, class_standing, plan_status }], page }` |

## Admin
| Route | Use |
|---|---|
| `POST /api/admin/pregenerate?secret=ADMIN_SECRET&limit=1` | pre-generate drafts for students with no plan; repeat until `remaining: 0`. Add `&redo=fallback` to regenerate drafts that fell back to the rule planner. Allows the rules fallback. |

The `refresh-risk` routes described in the earlier API.md (`POST|GET /api/admin/refresh-risk`) are not in this archive and are untouched.

## Raw risk object (`risk` on `GET /api/students/:id`)
```
{ risk_score: 0.456, risk_level: "medium", model_version: "weighted-v1", computed_at: "...",
  factors: { open_flags: { raw: { count, severity_points }, score, weight, contribution },
             non_passing, pace_shortfall, gpa_decline, retakes, work_hours, load_vs_target } }   // same shape
```
`risk_score = sum of contribution`. The score is **advisory only**: it informs a conversation and never restricts enrollment or blocks a plan. No demographic features; all students are synthetic. Show `advisory_note` from `/risk` near the score.

## Not built yet
- Every student-side screen (0a login, 1 upload, 4 audit review, 5 manual picker, 2 / 3 / 8 canvas and course panel, 6 / 7 dragging) has no routes.
- Professors and Reddit threads for the course panel have no data source.
- Students cannot see an approved plan yet: there is no student auth in the demo.

## Env
`DATABASE_URL`, `ADMIN_SECRET`, an LLM (`LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL`, and/or `ANTHROPIC_API_KEY`; `LLM_PROVIDER=compat|anthropic` puts one first).
Optional: `DEGREE_CREDITS` (120; used for `credits_remaining` when `programs.total_credits` is empty), `PLAN_TERM` (default `spring-2027`, the next term), `PLAN_EXTRA_TERMS` (default `1`), `RISK_MEDIUM_AT` (25), `RISK_HIGH_AT` (50).
