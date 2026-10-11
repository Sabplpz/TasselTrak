#  TasselTrak 🎓

**Plan your courses. Visualize your path. Graduate smarter.**

## 📖 Overview

TasselTrak is a degree-planning app for UCF Computer Science, Information Technology and Computer Engineering students and their advisors. A student sees their whole degree on one board: what is done, what is in progress, what they can take next and what is still locked behind a prerequisite. An advisor sees their caseload ranked by who needs attention, generates a draft plan with AI, edits it, and approves it.

Students and advisors work on the same plan, so there is one version of the truth.

## ❗ The Problem

- A degree audit tells a student what is left, but not what order to take it in or why a course is locked.
- Advisors carry large caseloads and can't read every transcript before every meeting, so students who are falling behind are easy to miss.
- Plans built by hand break quietly: a course lands in a term before its prerequisite, or in a section with no seats.

## 💡 Our Solution

- **One board for the whole degree.** Every course in the major is a note placed in the term it was taken or planned, with its prerequisite status shown on it.
- **Plans that are checked, not just drawn.** Every add, move and swap is validated against prerequisites, and for advisors against seats and time clashes, before it is saved.
- **AI drafts, people decide.** The planner proposes a next-term plan from the courses the student is actually eligible for. An advisor confirms, edits or replaces it, and signs off.
- **An explainable risk score.** Each student gets a 0 to 100 score with the factors behind it, so advisors know who to reach out to and why. It is advisory only and never blocks enrollment or a plan.

## ✨ Key Features

### For students
- Sign in and get matched to your student record by email.
- Pick your major and mark the courses you have taken or are taking now.
- See your board: completed, in-progress and planned terms, plus what is available now and what is locked (and what it needs).
- Add, move and remove planned courses, with the reason shown when a change isn't allowed and a suggested term that works.
- Credits done, in progress and planned, GPA, and projected graduation at a glance.

### For advisors
- Caseload list with search, major filter and sort by risk.
- Student panel with the risk score and its contributing factors.
- Generate a draft plan with AI, including the first plan for a student who has none.
- Edit the plan on a canvas: drag courses between terms, add, swap, remove and undo.
- Send for review, approve, reopen, and override a blocking problem with a written reason.
- Every change is recorded in an audit trail.

## 🛠️ Tech Stack

### Frontend
- Next.js 16 (App Router) and React 19, TypeScript
- Tailwind CSS 4
- React Flow (`@xyflow/react`) for the advisor plan canvas

### Backend
- Language: TypeScript
- Framework: Next.js route handlers (`web/app/api`)
- Auth: Firebase Authentication, with roles in Firebase Realtime Database
- AI: an LLM plans from a shortlist built in SQL (Google Gemini through its OpenAI-compatible API, or Anthropic Claude), with a rule-based fallback

### Database
- Neon (serverless Postgres), queried with `@neondatabase/serverless`
- Prerequisite, grading and GPA rules live in Postgres functions and views

### Data and analytics
- Databricks: a notebook job reads Neon into Delta tables, computes risk scores in Spark SQL and writes them back to Neon

### Tools
- Git & GitHub
- Visual Studio Code
- Figma

## ⚙️ How It Works

1. **Sign in.** Firebase checks the email and password and the account's role. Advisors are matched to an advisor row by email, students to a student row by email.
2. **Students set up.** A new student picks a major and marks their courses. That history is saved to Neon.
3. **The board is built from the database.** Postgres functions decide which courses are passed, in progress, available or locked.
4. **Planning.** A Postgres function lists the courses the student is eligible for. The LLM chooses from that list only, so it can't invent a course or skip a prerequisite. If the model fails, a rule-based planner can fill in.
5. **Review.** The advisor edits the draft. Each change is re-checked on the server. Blocking problems must be fixed or overridden before approval.
6. **Risk scores.** A Databricks job scores every student from seven academic signals and stores each factor's contribution, which the advisor panel displays.

## 🚀 Getting Started

### Prerequisites

- Node.js 20.6 or newer
- A Neon database
- A Firebase project with Email/Password sign-in and a Realtime Database
- An LLM API key (Gemini or Anthropic)
- Optional: a Databricks workspace, to recompute risk scores

### Installation

1. Clone the repository and install the web app:

   ```bash
   cd web
   npm install
   ```

2. Create the database. In the Neon SQL Editor, run these files in order:

   1. `data/tasseltrak_schema.sql`
   2. `data/migration/001_student_risk_scores.sql`
   3. `data/002_program_requisites_and_grades.sql`
   4. `data/seed.sql`
   5. `web/migrations/003_figma_alignment.sql`
   6. `web/migrations/004_student_side.sql`

   Then add the email column that links student accounts to student rows:

   ```sql
   ALTER TABLE students ADD COLUMN IF NOT EXISTS email TEXT;
   CREATE UNIQUE INDEX IF NOT EXISTS students_university_id_email_key
     ON students (university_id, lower(email)) WHERE email IS NOT NULL;
   ```

3. Create `web/.env.local`:

   ```bash
   DATABASE_URL=            # Neon pooled connection string
   DATABASE_URL_UNPOOLED=   # Neon direct connection string (used by the Databricks job)
   ADMIN_SECRET=

   LLM_API_KEY=             # Gemini key (or set ANTHROPIC_API_KEY instead)
   LLM_BASE_URL=
   LLM_MODEL=

   NEXT_PUBLIC_FIREBASE_API_KEY=
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
   NEXT_PUBLIC_FIREBASE_APP_ID=

   # Optional, for recomputing risk scores
   DATABRICKS_HOST=
   DATABRICKS_TOKEN=
   DATABRICKS_JOB_ID=
   ```

4. Create the accounts. In Firebase Authentication add a user, then in the Realtime Database set `users/<uid>/role` to `student` or `advisor`. The account's email must match `advisors.email` or `students.email` in Neon.

5. Run the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

In development, `?advisorId=1` or `?studentId=1` on the URL acts as that advisor or student after sign-in, which helps before accounts are linked.

### Tests

The route tests run the real API handlers against an in-process Postgres, without touching Neon or a real LLM:

```bash
cd web/tests/figma-alignment-advisors && npm install && npm test
cd web/tests/figma-alignment-students && npm install && npm test
```

`scripts/smoke-test.mjs` checks a running app end to end. It creates and approves a plan, so it changes the database.

## 📁 Project Structure

```
TasselTrak/
├── data/                 Neon schema, migrations 001-002 and the synthetic seed
├── notebooks/            Databricks notebooks (Neon connection test, risk scores)
├── scripts/              API smoke test and Databricks credential check
└── web/                  Next.js app
    ├── app/
    │   ├── login/        Sign-in and role picker
    │   ├── upload/       Student start page
    │   ├── pick-courses/ Pick a major and mark courses taken
    │   ├── board/        Student board
    │   ├── advisor/      Advisor caseload and student risk panel
    │   ├── plans/[id]/   Advisor plan canvas, review and approval
    │   └── api/          Route handlers
    ├── components/       Shared UI
    ├── lib/              Planner, plan checks, API clients, sessions
    ├── migrations/       Migrations 003-004
    ├── tests/            Route tests
    └── API.md            API reference
```

## ⚠️ Known Limitations

- All students, sections, grades and instructors are synthetic.
- The API routes do not verify the caller on the server. This is a demo, not a production deployment.
- Degree-audit PDF upload is not built yet. Students enter their history with the course picker.
- The risk score is a transparent weighted formula, not a trained model, so no accuracy is claimed.
- The student board uses buttons to plan courses. Drag and drop is on the advisor canvas only.

## 🔮 Future Improvements

- Read a degree-audit PDF and fill in the student's history from it.
- Seat-demand view for advisors, showing courses where planned students exceed open seats.
- Semantic course search for electives. The schema already has a pgvector embedding column on courses.
- Recompute one student's risk score on demand from the app.
- Server-side authentication on every API route.
- Professor ratings and discussion threads on the course panel.

## 👥 Team & Contributors

| Member | Role |
|--------|------|
| Nora Hashem | Frontend Developer |
| Sabrina Centeno | Backend Developer / AI Lead |
| Irene Valle | Frontend and UI/UX Designer |
| Daniel Rangosch| Data Engineer |

## 🏆 Hackathon

Created for [UCF Hackathon] — 2026.

## 📄 License

License information to be determined.
