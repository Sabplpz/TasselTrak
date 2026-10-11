-- =============================================================
-- TasselTrak migration 002
-- Run AFTER tasseltrak_schema.sql and 001_student_risk_scores.sql, BEFORE the seed.
-- Safe to re-run.
--
-- What it changes, and why:
--  1. prerequisites.program_id: the CS, IT and CpE flowcharts give different requisites for
--     the same course (e.g. COP 4331C), so prerequisites can now be per program.
--     NULL = applies to every program.
--  2. program_requirements.critical_path: the shaded "Critical Path Courses" on the flowcharts.
--  3. grade_passes(): the flowcharts say every course needs a C (2.0) or better,
--     so C-, D and F no longer satisfy a prerequisite. 'TC' = test credit.
--     A NULL grade means "in progress" and counts for planning, as in registration.
--  4. is_eligible / eligible_courses / student_overview use the rules above.
--  5. program_course_depth view, plan_candidates(student_id) function (the planner's tool).
-- =============================================================

-- 1. Per-program prerequisites ---------------------------------------------------------
ALTER TABLE prerequisites
  ADD COLUMN IF NOT EXISTS program_id INT REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE prerequisites
  DROP CONSTRAINT IF EXISTS prerequisites_course_id_required_course_id_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prereq_course_req_kind_program
  ON prerequisites (course_id, required_course_id, kind, (COALESCE(program_id, 0)));

CREATE INDEX IF NOT EXISTS idx_prereq_program ON prerequisites (program_id);

-- 2. Critical path -----------------------------------------------------------------------
ALTER TABLE program_requirements
  ADD COLUMN IF NOT EXISTS critical_path BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Grades ------------------------------------------------------------------------------
-- TRUE for a graded, passing result (C or better, or test credit / pass).
CREATE OR REPLACE FUNCTION grade_passes(g TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(g ~ '^(A|B|C$|C\+|TC|P$|S$)', FALSE);
$$;

-- 4. Eligibility -------------------------------------------------------------------------
-- A course is eligible when, for every prerequisite group of the student's program,
-- at least one course in the group is passed or in progress. Corequisites and min_grade
-- are not checked here.
CREATE OR REPLACE FUNCTION is_eligible(p_student_id INT, p_course_id INT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT program_id FROM students WHERE id = p_student_id),
  edges AS (
    SELECT p.group_no, p.required_course_id
    FROM prerequisites p, s
    WHERE p.course_id = p_course_id
      AND p.kind = 'prereq'
      AND (p.program_id IS NULL OR p.program_id = s.program_id)
  )
  SELECT NOT EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT group_no FROM edges) g
    WHERE NOT EXISTS (
      SELECT 1
      FROM edges e
      JOIN completed_courses cc
        ON cc.student_id = p_student_id
       AND cc.course_id  = e.required_course_id
       AND (cc.grade IS NULL OR grade_passes(cc.grade))
      WHERE e.group_no = g.group_no
    )
  );
$$;

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
            AND (cc.grade IS NULL OR grade_passes(cc.grade))
        )
    AND is_eligible(s.id, c.id);
$$;

-- 5a. Longest prerequisite chain to each course within a program (1 = no prerequisites)
CREATE OR REPLACE VIEW program_course_depth AS
WITH RECURSIVE chain AS (
  SELECT pr.program_id, pr.course_id, 1 AS depth
  FROM program_requirements pr
  UNION ALL
  SELECT ch.program_id, p.course_id, ch.depth + 1
  FROM chain ch
  JOIN prerequisites p
    ON p.required_course_id = ch.course_id
   AND p.kind = 'prereq'
   AND (p.program_id IS NULL OR p.program_id = ch.program_id)
  JOIN program_requirements pr2
    ON pr2.program_id = ch.program_id AND pr2.course_id = p.course_id
)
SELECT program_id, course_id, MAX(depth) AS depth
FROM chain
GROUP BY program_id, course_id;

-- 5b. The planner's tool: courses a student could take next, from their own program's
-- requirements. Excludes passed and in-progress courses, courses they are not yet eligible
-- for, and "pick N of M" groups that are already satisfied.
CREATE OR REPLACE FUNCTION plan_candidates(p_student_id INT)
RETURNS TABLE (
  course_id INT, code TEXT, title TEXT, credits NUMERIC,
  category TEXT, group_label TEXT, pick_count INT,
  critical_path BOOLEAN, depth INT, typically_offered TEXT[]
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code, c.title, c.credits,
         pr.category, pr.group_label, pr.pick_count,
         pr.critical_path, COALESCE(d.depth, 1), c.typically_offered
  FROM students s
  JOIN program_requirements pr ON pr.program_id = s.program_id
  JOIN courses c ON c.id = pr.course_id
  LEFT JOIN program_course_depth d
         ON d.program_id = pr.program_id AND d.course_id = pr.course_id
  WHERE s.id = p_student_id
    AND NOT EXISTS (
          SELECT 1 FROM completed_courses cc
          WHERE cc.student_id = s.id AND cc.course_id = c.id
            AND (cc.grade IS NULL OR grade_passes(cc.grade)))
    AND is_eligible(s.id, c.id)
    AND NOT (
          pr.pick_count IS NOT NULL
          AND (SELECT COUNT(DISTINCT pr2.course_id)
               FROM program_requirements pr2
               JOIN completed_courses cc2
                 ON cc2.student_id = s.id AND cc2.course_id = pr2.course_id
                AND (cc2.grade IS NULL OR grade_passes(cc2.grade))
               WHERE pr2.program_id = pr.program_id
                 AND pr2.group_label = pr.group_label) >= pr.pick_count)
  ORDER BY pr.critical_path DESC, COALESCE(d.depth, 1), c.code;
$$;

-- 4b. Caseload view: graded credits only, plus in-progress credits and the latest risk score.
-- New columns are appended at the end so the older columns keep their positions.
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
  END AS top_flag_severity,
  COALESCE(cr.credits_in_progress, 0) AS credits_in_progress,
  rl.risk_score,
  rl.risk_level
FROM students s
LEFT JOIN (
  SELECT cc.student_id,
         SUM(c.credits) FILTER (WHERE grade_passes(cc.grade)) AS credits_earned,
         SUM(c.credits) FILTER (WHERE cc.grade IS NULL)       AS credits_in_progress
  FROM completed_courses cc
  JOIN courses c ON c.id = cc.course_id
  GROUP BY cc.student_id
) cr ON cr.student_id = s.id
LEFT JOIN (
  SELECT student_id,
         COUNT(*) AS open_flags,
         MAX(CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS top_severity
  FROM student_flags
  WHERE status = 'open'
  GROUP BY student_id
) f ON f.student_id = s.id
LEFT JOIN student_risk_latest rl ON rl.student_id = s.id;
