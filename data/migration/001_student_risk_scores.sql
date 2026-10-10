-- =============================================================
-- TasselTrak migration 001: student_risk_scores
-- Output of the Databricks notebook. Run once on Neon (SQL Editor or psql).
-- Safe to re-run.
--
-- Rules for this table:
--   * Advisor-facing and explainable: every score carries its factors.
--   * No demographic features in the model that writes here.
--   * It informs an advising conversation. It never restricts enrollment.
--   * Demo data is synthetic, so the score reflects the generator's rules.
--     Do not quote accuracy numbers.
-- =============================================================

CREATE TABLE IF NOT EXISTS student_risk_scores (
  id             SERIAL PRIMARY KEY,
  student_id     INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id      INT REFERENCES courses(id) ON DELETE CASCADE,   -- NULL = overall score
  risk_score     NUMERIC(4,3) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  risk_level     TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  factors        JSONB NOT NULL DEFAULT '{}',   -- why: {"behind_pace_terms": 1, "dfw_rate_pct": 31.0, ...}
  model_version  TEXT NOT NULL,                 -- e.g. 'weighted-v1'
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per student, course (or overall) and model version, so reruns upsert:
--   INSERT ... ON CONFLICT (student_id, (COALESCE(course_id, 0)), model_version) DO UPDATE ...
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_student_course_model
  ON student_risk_scores (student_id, (COALESCE(course_id, 0)), model_version);

CREATE INDEX IF NOT EXISTS idx_risk_student ON student_risk_scores (student_id);

-- Latest overall score per student, for the caseload badges
CREATE OR REPLACE VIEW student_risk_latest AS
SELECT DISTINCT ON (student_id)
  student_id,
  risk_score,
  risk_level,
  factors,
  model_version,
  computed_at
FROM student_risk_scores
WHERE course_id IS NULL
ORDER BY student_id, computed_at DESC;
