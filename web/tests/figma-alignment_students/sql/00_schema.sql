-- QUERY TRUNCATED
-- =============================================================
-- TasselTrak - Neon (Postgres) schema
-- AI-assisted academic advising: advisors review and approve
-- AI-drafted degree plans for their students.
--
-- Run once on an empty Neon database:
--   Paste into the Neon SQL Editor.
--
-- =============================================================


-- =============================================================
-- 1. Institutions and catalog (official school data)
-- =============================================================

CREATE TABLE IF NOT EXISTS universities (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL UNIQUE,              -- 'ucf'
  state    TEXT,
  website  TEXT
);

CREATE TABLE IF NOT EXISTS terms (
  id                    SERIAL PRIMARY KEY,
  university_id         INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,        -- 'fall-2026'
  name                  TEXT NOT NULL,        -- 'Fall 2026'
  season                TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'fall')),
  year                  INT  NOT NULL,
  starts_on             DATE,
  UNIQUE (university_id, code)
);

CREATE TABLE IF NOT EXISTS courses (
  id                 SERIAL PRIMARY KEY,
  university_id      INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  subject            TEXT NOT NULL,           -- 'COP'
  number             TEXT NOT NULL,           -- '3502C'
  code               TEXT GENERATED ALWAYS AS (subject || ' ' || number) STORED,
  title              TEXT NOT NULL,
  credits            NUMERIC(3,1) NOT NULL DEFAULT 3,
  description        TEXT,
  is_gen_ed          BOOLEAN NOT NULL DEFAULT FALSE,
  gen_ed_area        TEXT,
  typically_offered  TEXT[]  NOT NULL DEFAULT '{}',   -- '{fall,spring}'
  UNIQUE (university_id, subject, number)
);

-- Requirements are ANDed across group_no values and ORed within one group_no.
-- Example: (MAC 2311 OR MAC 2281) AND COP 3502C
--   -> (MAC 2311, group 1), (MAC 2281, group 1), (COP 3502C, group 2)
CREATE TABLE IF NOT EXISTS prerequisites (
  id                  SERIAL PRIMARY KEY,
  course_id           INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  required_course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'prereq' CHECK (kind IN ('prereq', 'coreq')),
  group_no            INT  NOT NULL DEFAULT 1,
  min_grade           TEXT,
  CHECK (course_id <> required_course_id),
  UNIQUE (course_id, required_course_id, kind)
);

CREATE TABLE IF NOT EXISTS instructors (
  id             SERIAL PRIMARY KEY,
  university_id  INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  department     TEXT,
  UNIQUE (university_id, name, department)
);

CREATE TABLE IF NOT EXISTS sections (
  id            SERIAL PRIMARY KEY,
  course_id     INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_id       INT NOT NULL REFERENCES terms(id)   ON DELETE CASCADE,
  instructor_id INT REFERENCES instructors(id) ON DELETE SET NULL,
  crn           TEXT,
  section_code  TEXT,
  modality      TEXT CHECK (modality IN ('in-person', 'online', 'hybrid', 'mixed')),
  days          TEXT[] NOT NULL DEFAULT '{}',          -- '{M,W,F}'
  start_time    TIME,
  end_time      TIME,
  building      TEXT,
  room          TEXT,
  capacity      INT,
  enrolled      INT,
  seats_open    INT GENERATED ALWAYS AS (capacity - enrolled) STORED,
  UNIQUE (term_id, crn)
);

CREATE TABLE IF NOT EXISTS programs (
  id             SERIAL PRIMARY KEY,
  university_id  INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,                        -- 'Computer Science B.S.'
  degree_type    TEXT,                                 -- 'B.S.'
  catalog_year   INT  NOT NULL,
  total_credits  INT,
  UNIQUE (university_id, name, catalog_year)
);

-- Courses sharing a group_label are "pick pick_count of these". NULL pick_count = required.
CREATE TABLE IF NOT EXISTS program_requirements (
  id           SERIAL PRIMARY KEY,
  program_id   INT  NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  course_id    INT  NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  category     TEXT NOT NULL,                          -- 'core', 'math', 'elective', 'gen_ed'
  group_label  TEXT,
  pick_count   INT,
  UNIQUE (program_id, course_id)
);

-- =============================================================
-- 2. People: advisors and students
-- =============================================================

CREATE TABLE IF NOT EXISTS advisors (
  id             SERIAL PRIMARY KEY,
  university_id  INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  department     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (university_id, email)
);

CREATE TABLE IF NOT EXISTS students (
  id                        SERIAL PRIMARY KEY,
  university_id             INT  NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  advisor_id                INT  REFERENCES advisors(id) ON DELETE SET NULL,
  program_id                INT  REFERENCES programs(id) ON DELETE SET NULL,
  external_id               TEXT,                      -- synthetic id, never a real student number
  display_name              TEXT NOT NULL,
  is_synthetic              BOOLEAN NOT NULL DEFAULT TRUE,
  entry_term_id             INT  REFERENCES terms(id) ON DELETE SET NULL,
  expected_graduation_term_id INT REFERENCES terms(id) ON DELETE SET NULL,
  target_credits            INT  NOT NULL DEFAULT 15,
  work_hours_per_week       INT  NOT NULL DEFAULT 0,
  preferences               JSONB NOT NULL DEFAULT '{}',   -- {"avoid_mornings": true}
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (university_id, external_id)
);

CREATE TABLE IF NOT EXISTS completed_courses (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id   INT NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  term_id     INT REFERENCES terms(id) ON DELETE SET NULL,
  grade       TEXT,                                    -- 'A', 'B+', 'F', 'W', ...
  UNIQUE (student_id, course_id, term_id)
);

-- =============================================================
-- 3. Plans: AI drafts, advisors review and approve
-- =============================================================

CREATE TABLE IF NOT EXISTS plans (
  id           SERIAL PRIMARY KEY,
  student_id   INT  NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Next semester plan',
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),
  created_by   TEXT NOT NULL DEFAULT 'ai' CHECK (created_by IN ('ai', 'advisor')),
  model_name   TEXT,                                   -- e.g. 'Qwen/Qwen3.8-27B', shown in the README
  rationale    TEXT,                                   -- the AI's "why this plan" summary
  approved_by  INT REFERENCES advisors(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_items (
  id          SERIAL PRIMARY KEY,
  plan_id     INT NOT NULL REFERENCES plans(id)   ON DELETE CASCADE,
  term_id     INT NOT NULL REFERENCES terms(id)   ON DELETE CASCADE,
  course_id   INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id  INT REFERENCES sections(id) ON DELETE SET NULL,
  reason      TEXT,                                    -- per-course explanation
  source      TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'advisor')),
  UNIQUE (plan_id, term_id, course_id)
);

-- Audit trail: who did what to a plan (the human-in-the-loop story)
CREATE TABLE IF NOT EXISTS plan_events (
  id          SERIAL PRIMARY KEY,
  plan_id     INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('ai', 'advisor', 'system')),
  advisor_id  INT REFERENCES advisors(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                           -- 'generated', 'swapped_course', 'approved'
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advisor_notes (
  id          SERIAL PRIMARY KEY,
  student_id  INT  NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  advisor_id  INT  NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

