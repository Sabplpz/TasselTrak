-- =============================================================
-- TasselTrak migration 003: Figma alignment
-- Run AFTER tasseltrak_schema.sql, 001, 002 (and the seed is fine to run before or after).
-- Safe to re-run.
--
--  1. advisors.can_override        who may override a blocking problem (A6a)
--  2. plans.submitted_at           "Sent for review Oct 8" (A7)
--  3. plan_items.confirmed         AI suggestions stay "Suggested" until an advisor confirms (A3)
--  4. plan_items.override_*        the "Override" tag and its hover text (A6b)
--  5. grade_points() + student_gpa GPA shown in the caseload and on the board
-- =============================================================

-- 1. Override permission. Everyone is allowed by default so the demo keeps working.
--    To demo the "not authorized" path:  UPDATE advisors SET can_override = FALSE WHERE id = 2;
ALTER TABLE advisors
  ADD COLUMN IF NOT EXISTS can_override BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Review timestamp
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- 3 + 4. Per-course state on the plan board
ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_by   INT REFERENCES advisors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_note TEXT,
  ADD COLUMN IF NOT EXISTS override_at   TIMESTAMPTZ;

-- Anything an advisor put on the board themselves counts as confirmed.
UPDATE plan_items SET confirmed = TRUE WHERE source = 'advisor' AND confirmed = FALSE;

-- 5. GPA. Grade points follow the UCF scale (A- = 3.75, B+ = 3.25, ...). Adjust if your
--    registrar differs. W, TC, P, S and in-progress (NULL) grades are not part of the GPA.
CREATE OR REPLACE FUNCTION grade_points(g TEXT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE g
    WHEN 'A'  THEN 4.00 WHEN 'A-' THEN 3.75
    WHEN 'B+' THEN 3.25 WHEN 'B'  THEN 3.00 WHEN 'B-' THEN 2.75
    WHEN 'C+' THEN 2.25 WHEN 'C'  THEN 2.00 WHEN 'C-' THEN 1.75
    WHEN 'D+' THEN 1.25 WHEN 'D'  THEN 1.00 WHEN 'D-' THEN 0.75
    WHEN 'F'  THEN 0.00
  END;
$$;

CREATE OR REPLACE VIEW student_gpa AS
SELECT cc.student_id,
       ROUND(SUM(grade_points(cc.grade) * c.credits) / NULLIF(SUM(c.credits), 0), 2) AS gpa
FROM completed_courses cc
JOIN courses c ON c.id = cc.course_id
WHERE grade_points(cc.grade) IS NOT NULL AND c.credits > 0
GROUP BY cc.student_id;
