# TasselTrak API (for the frontend)

All routes return JSON. Errors are `{ "error": "message", "code": "machine_code", ...extras }` with a 4xx/5xx status; switch on `code`, not on the message.
No auth in the demo: advisor routes take `advisorId` (query or body). Numbers are real numbers; risk scores are integers 0..100.
Term codes look like `spring-2027`, `fall-2026` (the same codes as the `terms` table).

Run `migrations/003_figma_alignment.sql` and then `migrations/004_student_side.sql` after 001 and 002. Both are safe to re-run. **Run 004 before using the new code: advisor edits now also write `plan_events.student_id`, which 004 adds.**

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
| `GET /api/plans/:id/prerequisites` | read only, used by the plan canvas for its connectors. Prerequisite edges for the plan's student's program (plus any course already in the plan): `{ prerequisites: [{ courseId, courseCode, requiredCourseId, requiredCode, kind (prereq/coreq), groupNo, minGrade }] }`. Rows with the same `groupNo` are alternatives; a course needs every group. 404 if the plan does not exist. |
| `GET /api/plans/:id/course-options?term=spring-2027&search=` | **Add-course picker.** `{ term: { code, name, open, scheduleAvailable }, groups: [{ requirement, fills, courses: [{ courseId, code, title, credits, category, criticalPath, isSlot, prerequisitesMet, missing[], seatsOpen }] }] }`. Courses already on the board, and requirement slots already used, are left out. `prerequisitesMet` is judged for that term. |
| `POST /api/plans/:id/courses` `{courseId, termCode?, reason?, advisorId?, dryRun?, force?, note?}` | add a course (`termCode` defaults to the next term). **201** plan + `added`. **422 `check_failed`** `{ problems[], missing[], blockingCourse, suggestedTerm, breaks[], term }`: show the reason in place and add nothing. `dryRun: true` runs the checks only. `force: true` adds anyway as an override (needs an authorized advisor, else 403 `not_authorized`). |
| `PATCH /api/plans/:id/courses/:courseId` `{termCode, advisorId?, dryRun?, force?}` | move to another term. 422 `check_failed` carries `suggestedTerm` for "Move to Spring 2027". **A move that would leave an already-planned course without its prerequisite** (for example moving COP 3330 into the same or a later semester than COP 3503C) is blocked too: a `breaks_dependent` problem, `breaks: [{ courseId, code, termCode }]` naming the courses it would break, and `suggestedTerm` is the earliest semester that works. An authorized advisor can still `force` it (override); students cannot. |
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
  items: [{ id, courseId, code, title, credits, termCode, termName, reason, source (ai|advisor|student),
            confirmed, suggested, fills,
            status (available|needs|locked), needs[],         // "Needs COP 3503 +1" = needs.length 2
            section: { id, crn, section_code, modality, days[], start_time, end_time, seats_open, capacity, instructor } | null,
            issues: [{ type, severity, message, courseId, code, termCode, overridden? }],
            override: { advisorId, advisorName, at, note } | null }],
  totals: { credits, target, courses, terms, overrides, byTerm: [{ code, credits }] },
  issues: [...plan-level issues],             // time clashes, credits over/under a term
  blockingIssues: [...],                      // each blocking problem once (the A5 checklist)
  blocking: <count of blockingIssues>, canApprove, readOnly,
  events: [{ actor_type (ai|advisor|system|student), action, detail, created_at, advisor_name, student_name }] }   // audit trail
```
- The board is `history` (taken and in-progress courses, by `termCode`) plus `items` (planned courses, by `termCode`); `terms` gives the column headers.
- `status`: `available` = every prerequisite is passed; `needs` = the missing ones are being taken now (`needs` lists them); `locked` = a missing prerequisite has not started yet.
- A prerequisite counts for a course in term T when it is passed, or in progress / planned in an **earlier** term than T. Taking both in the same term does not count (that is the A4 error).
- Seats and sections are only checked for terms that have a published schedule (`scheduleAvailable`).
- Issue types: `not_eligible, already_completed, already_planned, no_section, seat_full, seat_risk, time_conflict, credits_over, credits_under, not_in_program, term_not_open, breaks_dependent`. Severity `high` blocks approval unless the course is overridden.
- Only the next term gets a seat-checked, model-chosen draft. Later terms (default one more, env `PLAN_EXTRA_TERMS`) are filled by rules once prerequisites allow.

## Student screens

No student auth in the demo: student routes take the student id in the path. Real UCF sign-in is not built. A student is the "actor" of their own edits (`plan_events.actor_type = 'student'`); they use the **same `plans` / `plan_items` rows** as the advisor, so advisor review, risk and seat demand keep working. A student plan has `createdBy: "student"`, a student-placed course has `source: "student"` (and is never a "Suggested" chip).

### Login and getting started (screens 0a, 1, 5)

| Route | Use |
|---|---|
| `GET /api/students?search=&limit=20&offset=0` | **0a "I'm a student" (demo).** Pick-a-student list: `{ page, students: [{ student_id, display_name, program_name, advisor_name, courses_on_file, plan_status, sample }] }` |
| `POST /api/students/login` `{studentId}` | `{ studentId, student: { id, name, programId, programName }, next }`. `next` is `"upload"` (screen 1, nothing on file) or `"board"` (screen 2). No password check. 404 `student_not_found`. |
| `GET /api/programs` | **5 major picker.** `{ programs: [{ id, name, degreeType, catalogYear, totalCredits, courses }] }`. `totalCredits` falls back to env `DEGREE_CREDITS` (120). |
| `GET /api/programs/:id/courses` | **5 tick list.** `{ program, groups: [{ requirement, category, pickCount, courses: [{ courseId, code, title, credits, category, groupLabel, criticalPath, isSlot }] }] }`. The bottom bar's credit count is the sum of `credits` of the ticked rows (client side). Requirement slots (`GEP HUM1`, `ELEC TECH1`) have `isSlot: true`: "a course from this group". A last group `other_prerequisites` lists courses that are prerequisites of the major's courses (at any depth) but are not requirements themselves (e.g. `COP 2500` before `COP 3330`); they have `inProgram: false`. Show them so a student can tick them. |
| `GET /api/students/:id/completed-courses` | what is on file: `{ programId, courses: [{ courseId, code, title, credits, grade, status (taken\|in_progress\|not_passed), termCode }] }` |
| `PUT /api/students/:id/completed-courses` `{programId?, mode?, courses: [{courseId, grade?, status?, termCode?}]}` | **5 "Build my board"** and **4 "Looks good, build my board"**. Saves the major and the courses in one statement (all or nothing). `mode: "replace"` (default) makes the list the student's whole history; `"merge"` only rewrites the listed courses. `status` is `"taken"` (default) or `"in_progress"`. A taken course with no grade is saved as **`P`** (counts as passed, left out of the GPA). An in-progress course has no grade and lands in the current term unless `termCode` is given. Grades: `A..D` with `+`/`-`, `F`, `W`, `P`, `S`, `TC`. Returns `{ saved, programId, credits: { earned, inProgress }, next: "board" }`. Errors: 400 `invalid_grade` / `invalid_request` / `term_not_found`, 404 `program_not_found` / `course_not_found` / `student_not_found`. **This replaces real history, so do not call it on a real student while testing.** |

### Audit upload (screens 1 and 4) - proposed, NOT built
Needs a sample degree-audit PDF first. Proposed contract:
- `POST /api/students/:id/audit` (multipart `file`) reads the PDF and returns `{ auditId, found: 14, courses: [{ rowId, rawText, code, title, termCode, grade, courseId (null if unmatched), confidence 0..1, needsReview, candidates: [{ courseId, code, title }] }] }`. Rows with `needsReview: true` are the two flagged ones; `candidates` fills the fix-it dropdown.
- "Looks good, build my board" then calls the existing `PUT /api/students/:id/completed-courses` with the corrected rows. "Re-upload" is just another `POST`. Nothing is written until that PUT.

### The canvas (screens 2, 3, 6, 7, 8)

| Route | Use |
|---|---|
| `GET /api/students/:id/board` | **2 Canvas.** One call. 409 `no_program` until a major is saved. See the object below. |
| `GET /api/students/:id/courses/:courseId?term=spring-2027` | **3 / 8 side panel.** `{ course, status, plannedIn, prerequisites, unlocks, addTo, professors, threads }` (below). 404 `course_not_found`, 400 `term_not_found`. |
| `POST /api/students/:id/board/courses` `{courseId, termCode?, dryRun?}` | **8 "Add to Spring 2027"**, or dropping an unplaced note on a semester (`termCode` defaults to the next term). Creates the student's plan on the first successful add (a failed first add leaves no plan behind). **201** plan object + `added`. **422 `check_failed`** `{ problems[], missing[], blockingCourse, suggestedTerm, breaks[], term }` (same payload as the advisor routes). `dryRun: true` only checks (200 `{ dryRun, blocking, problems, ... }`) and never creates a plan. |
| `PATCH /api/students/:id/board/courses/:courseId` `{termCode, dryRun?}` | **6 / 7 dragging a planned note.** Call with `dryRun: true` while hovering: `blocking: false` = valid drop (gold "Drop to move here"), `blocking: true` = "Can't move here yet" with `blockingCourse` ("Blocking course" marker, tooltip "Needs COP 3503 first") and `suggestedTerm`. On drop call it without `dryRun`: **200** plan + `moved: { courseId, code, from, to }`, or **422 `check_failed`** (same payload). `totals.byTerm` in the response gives both semesters' credit totals. 404 `item_not_found` if the course is not on the plan. |
| `DELETE /api/students/:id/board/courses/:courseId` | take a planned course off the board; returns the plan + `removed`. |
| `POST /api/students/:id/board/courses/:courseId/restore` | undo the last remove. 404 `nothing_to_restore`. |
| `GET /api/students/:id/plan` | unchanged: the same plan object the advisor sees (use for the plan-status chip). |

**Who may edit:** a student can edit a plan their advisor suggested (and one they made themselves) while it is a **draft or in review**. Editing a plan in review sends it back to draft, like an advisor edit. **Approved** -> every edit is **409 `read_only`** until the advisor reopens it. `dryRun` always works. A student **cannot force an override** (`force` is ignored; a blocked drop is a 422). **Seats and sections are not part of the student side:** student checks never return `no_section`, `seat_full`, `seat_risk` or a section time clash, and the board hides those issues (the advisor's plan view still shows them). If an advisor regenerates with `replace: true`, the student's draft is archived like any other draft.

**Board object (`GET /api/students/:id/board`)**
```
{ student: { id, name, programId, programName },
  header: { gpa, creditsCompleted, creditsInProgress, creditsPlanned, creditsTotal, creditsRemaining,
            projectedGraduation: { code, name } | null, currentTerm: { code, name } | null, planTerm: { code, name } },
  plan: { id, status, readOnly, createdBy, approvedBy, blocking } | null,
  editable: true | false,            // false only when the plan is approved
  terms: [{ code, name, state (completed|current|planned), now, label ("Completed"|"In progress"|"Up next"|"Later"), credits, courses }],
  courses: [{ courseId, code, title, credits, category, groupLabel, pickCount, criticalPath, isSlot, inProgram,
              status (taken|in_progress|planned|available|locked),
              prereq (available|needs|locked), needs[],         // "Needs COP 3503": the missing ones
              termCode, grade, retake, planItemId, suggested, confirmed, issues[], override }],
  edges: [{ from, to, group }],      // prerequisite lines: `from` is a prerequisite of `to`; same `group` = "one of"
  totals: { target, byTerm: [{ code, credits }] } }
```
- `courses` has one note for every course of the major, plus every prerequisite of those courses that is not a requirement itself (e.g. `COP 2500`, `category: "prerequisite"`, `inProgram: false`) so a locked course always has a visible note and line explaining why, plus any other course the student took or planned. Put a note in the column of its `termCode`. `termCode: null` means no semester: for `taken` it is "earlier / no term on file", for `available` / `locked` it is the unplaced pool.
- `locked` covers two cases: `prereq: "needs"` (a missing prerequisite is being taken right now) and `prereq: "locked"` (a missing prerequisite has not started). A `needs` course can still be added to a later term; ask the side panel's `addTo` or use `dryRun`.
- `retake: true` marks a course the student did not pass (F / W); it is shown as available or locked again.
- `creditsCompleted` counts passed courses only; `creditsRemaining = creditsTotal - creditsCompleted` (same as the advisor list); `gpa` is from `student_gpa`.
- `projectedGraduation`: if the plan already covers every remaining credit, the last term with a course; otherwise extra terms at the student's `target_credits` after the later of the last used term and the current term, skipping summer. `null` when the `terms` table has no term that far out (a term code is never invented).

**Course panel object (`GET /api/students/:id/courses/:courseId`)**
```
{ course: { courseId, code, title, credits, category, groupLabel },
  status (taken|in_progress|planned|available|locked), plannedIn: "spring-2027" | null,
  prerequisites: [{ options: [{ courseId, code, title, state (passed|in_progress|planned|not_started) }], met }],   // each group = "one of"
  unlocks: [{ courseId, code, title, credits, state, opensUp }],   // opensUp: taking this course would make it takeable ("what taking it would open up")
  addTo: { termCode, termName, allowed, problems[], missing[], blockingCourse, suggestedTerm } | null,   // null for taken / in progress / planned
  professors: [{ name, rating, ratingCount, difficulty, url }],
  threads: [{ title, url, source, replies, postedAt }] }
```
`professors` and `threads` come from `course_professors` / `course_threads` (migration 004). **They are empty until you load data;** there is no scraper.

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
- **Degree-audit upload and review (screens 1 and 4):** proposed contract above; needs a sample audit PDF. "Pick courses manually" (screen 5) works without it.
- **Real student auth (UCF email + password, "Sign in with UCF"):** out of scope; the demo login only picks a student.
- **Professors and Reddit threads:** tables exist (migration 004), no data source.
- Nothing student-side has been run against the real Neon database yet; only the in-process test database.

## Figma notes to add (the student screens had none)
- **0a Landing / Login:** `GET /api/students?search=` (demo picker), `POST /api/students/login` `{studentId}` -> `next`.
- **1 Upload:** "Pick courses manually" -> screen 5. Upload -> `POST /api/students/:id/audit` (proposed, not built).
- **4 Audit review:** `POST /api/students/:id/audit` rows with `needsReview` + `candidates`; "Looks good, build my board" -> `PUT /api/students/:id/completed-courses`.
- **5 Manual picker:** `GET /api/programs`, `GET /api/programs/:id/courses`, "Build my board" -> `PUT /api/students/:id/completed-courses` `{programId, courses}`.
- **2 Canvas:** `GET /api/students/:id/board`.
- **3 / 8 Course selected:** `GET /api/students/:id/courses/:courseId?term=spring-2027`; "Add to Spring 2027" -> `POST /api/students/:id/board/courses` `{courseId, termCode}`.
- **6 / 7 Dragging:** hover -> `PATCH /api/students/:id/board/courses/:courseId` `{termCode, dryRun: true}`; drop -> same without `dryRun`; 422 `check_failed` gives `blockingCourse` and `suggestedTerm`.
- **A7 last bar (what the student sees):** `GET /api/students/:id/board` -> `plan.status`, `readOnly`, `editable`.
- Also (from before): use `spring-2027`-style term codes in the notes, and drop the async generate poll/cancel routes.

## Env
`DATABASE_URL`, `ADMIN_SECRET`, an LLM (`LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL`, and/or `ANTHROPIC_API_KEY`; `LLM_PROVIDER=compat|anthropic` puts one first).
Optional: `DEGREE_CREDITS` (120; used for `credits_remaining` when `programs.total_credits` is empty), `PLAN_TERM` (default `spring-2027`, the next term), `PLAN_EXTRA_TERMS` (default `1`), `RISK_MEDIUM_AT` (25), `RISK_HIGH_AT` (50).
