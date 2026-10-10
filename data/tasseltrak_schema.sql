-- =============================================================
-- TasselTrak - Neon (Postgres) schema
-- AI-assisted academic advising: advisors review and approve
-- AI-drafted degree plans for their students.
--
-- Run once on an empty Neon database:
--   Paste into the Neon SQL Editor.
--
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy course search
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector, course similarity search

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
  embedding          vector(384),             -- sentence-transformers/all-MiniLM-L6-v2
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

-- Issues surfaced to the advisor (rule-based, not model-based)
CREATE TABLE IF NOT EXISTS student_flags (
  id           SERIAL PRIMARY KEY,
  student_id   INT  NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id    INT  REFERENCES courses(id) ON DELETE SET NULL,
  flag_type    TEXT NOT NULL CHECK (flag_type IN
                 ('missing_prereq', 'behind_pace', 'seat_risk', 'time_conflict', 'gpa_risk', 'other')),
  severity     TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- =============================================================
-- 4. Indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_courses_code_trgm   ON courses USING gin (code  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_courses_title_trgm  ON courses USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_courses_embedding   ON courses USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_prereq_course       ON prerequisites (course_id);
CREATE INDEX IF NOT EXISTS idx_prereq_required     ON prerequisites (required_course_id);
CREATE INDEX IF NOT EXISTS idx_sections_course_term ON sections (course_id, term_id);
CREATE INDEX IF NOT EXISTS idx_students_advisor    ON students (advisor_id);
CREATE INDEX IF NOT EXISTS idx_completed_student   ON completed_courses (student_id);
CREATE INDEX IF NOT EXISTS idx_completed_course    ON completed_courses (course_id);
CREATE INDEX IF NOT EXISTS idx_plans_student       ON plans (student_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan     ON plan_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_course   ON plan_items (course_id, term_id);
CREATE INDEX IF NOT EXISTS idx_flags_student_open  ON student_flags (student_id) WHERE status = 'open';

-- =============================================================
-- 5. Planning helpers (SQL, so the backend can call them directly)
-- =============================================================

-- TRUE if the student has satisfied every prerequisite group for the course.
-- A completed course counts unless its grade is F or W (W, WF).
-- min_grade is not enforced here; add that if you have time.
CREATE OR REPLACE FUNCTION is_eligible(p_student_id INT, p_course_id INT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT group_no
          FROM prerequisites
          WHERE course_id = p_course_id AND kind = 'prereq') g
    WHERE NOT EXISTS (
      SELECT 1
      FROM prerequisites p
      JOIN completed_courses cc
        ON cc.student_id = p_student_id
       AND cc.course_id  = p.required_course_id
       AND COALESCE(cc.grade, '') !~ '^(F|W)'
      WHERE p.course_id = p_course_id
        AND p.kind      = 'prereq'
        AND p.group_no  = g.group_no
    )
  );
$$;

-- Courses at the student's university that they have not passed and are eligible to take.
CREATE OR REPLACE FUNCTION eligible_courses(p_student_id INT)
RETURNS SETOF courses
LANGUAGE sql STABLE AS $$
  SELECT c.*
  FROM courses c
  JOIN students s ON s.id = p_student_id AND s.university_id = c.university_id
  WHERE NOT EXISTS (
          SELECT 1 FROM completed_courses cc
          WHERE cc.student_id = s.id
            AND cc.course_id  = c.id
            AND COALESCE(cc.grade, '') !~ '^(F|W)'
        )
    AND is_eligible(s.id, c.id);
$$;

-- =============================================================
-- 6. Views for the advisor dashboard
-- =============================================================

-- Caseload list: one row per student with open-flag counts and credits earned
CREATE OR REPLACE VIEW student_overview AS
SELECT
  s.id AS student_id,
  s.display_name,
  s.advisor_id,
  s.program_id,
  s.is_synthetic,
  COALESCE(cr.credits_earned, 0) AS credits_earned,
  COALESCE(f.open_flags, 0)      AS open_flags,
  CASE f.top_severity
    WHEN 3 THEN 'high'
    WHEN 2 THEN 'medium'
    WHEN 1 THEN 'low'
  END AS top_flag_severity
FROM students s
LEFT JOIN (
  SELECT cc.student_id, SUM(c.credits) AS credits_earned
  FROM completed_courses cc
  JOIN courses c ON c.id = cc.course_id
  WHERE COALESCE(cc.grade, '') !~ '^(F|W)'
  GROUP BY cc.student_id
) cr ON cr.student_id = s.id
LEFT JOIN (
  SELECT student_id,
         COUNT(*) AS open_flags,
         MAX(CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS top_severity
  FROM student_flags
  WHERE status = 'open'
  GROUP BY student_id
) f ON f.student_id = s.id;

-- Planned demand vs. seats, per course per term
CREATE OR REPLACE VIEW course_demand AS
SELECT
  d.term_id,
  d.course_id,
  c.code,
  c.title,
  d.planned_students,
  COALESCE(sec.total_capacity, 0) AS total_capacity,
  COALESCE(sec.total_enrolled, 0) AS total_enrolled,
  d.planned_students + COALESCE(sec.total_enrolled, 0) - COALESCE(sec.total_capacity, 0) AS seat_shortfall
FROM (
  SELECT pi.term_id, pi.course_id, COUNT(DISTINCT p.student_id) AS planned_students
  FROM plan_items pi
  JOIN plans p ON p.id = pi.plan_id
  WHERE p.status IN ('draft', 'in_review', 'approved')
  GROUP BY pi.term_id, pi.course_id
) d
JOIN courses c ON c.id = d.course_id
LEFT JOIN (
  SELECT course_id, term_id, SUM(capacity) AS total_capacity, SUM(enrolled) AS total_enrolled
  FROM sections
  GROUP BY course_id, term_id
) sec ON sec.course_id = d.course_id AND sec.term_id = d.term_id;

-- Courses that gate the most other courses
CREATE OR REPLACE VIEW prereq_fanout AS
SELECT
  c.id AS course_id,
  c.code,
  c.title,
  COUNT(DISTINCT p.course_id) AS courses_unlocked
FROM courses c
JOIN prerequisites p ON p.required_course_id = c.id
GROUP BY c.id, c.code, c.title;

-- D/F/W rate per course, from completed_courses
CREATE OR REPLACE VIEW course_dfw AS
SELECT
  c.id AS course_id,
  c.code,
  c.title,
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE cc.grade ~ '^(D|F|W)') AS dfw_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cc.grade ~ '^(D|F|W)') / NULLIF(COUNT(*), 0), 1) AS dfw_rate_pct
FROM completed_courses cc
JOIN courses c ON c.id = cc.course_id
WHERE cc.grade IS NOT NULL
GROUP BY c.id, c.code, c.title;
