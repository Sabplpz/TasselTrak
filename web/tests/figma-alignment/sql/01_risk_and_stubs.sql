-- Migration 001 (from the project), student_risk_scores
CREATE TABLE IF NOT EXISTS student_risk_scores (
  id             SERIAL PRIMARY KEY,
  student_id     INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id      INT REFERENCES courses(id) ON DELETE CASCADE,
  risk_score     NUMERIC(4,3) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  risk_level     TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  factors        JSONB NOT NULL DEFAULT '{}',
  model_version  TEXT NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_student_course_model
  ON student_risk_scores (student_id, (COALESCE(course_id, 0)), model_version);
CREATE INDEX IF NOT EXISTS idx_risk_student ON student_risk_scores (student_id);
CREATE OR REPLACE VIEW student_risk_latest AS
SELECT DISTINCT ON (student_id) student_id, risk_score, risk_level, factors, model_version, computed_at
FROM student_risk_scores WHERE course_id IS NULL
ORDER BY student_id, computed_at DESC;

-- Stand-ins for the parts of the schema that were cut off in the pasted file.
CREATE TABLE IF NOT EXISTS student_flags (
  id         SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  INT REFERENCES courses(id) ON DELETE SET NULL,
  flag_type  TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
