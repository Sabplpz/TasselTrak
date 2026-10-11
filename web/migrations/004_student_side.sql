-- =============================================================
-- TasselTrak migration 004: student side
-- Run AFTER 003. Safe to re-run.
--
--  1. Students can own a plan (plans.created_by), put courses on it
--     (plan_items.source) and appear in the audit trail
--     (plan_events.actor_type, plan_events.student_id).
--  2. course_professors / course_threads: optional data for the course
--     side panel (screens 3 and 8). Empty until you load data; the API
--     returns empty lists meanwhile.
-- =============================================================

-- 1. Drop the old CHECK constraints on those three columns (whatever they are called) and
--    add ones that also allow 'student'.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT rel.relname AS tbl, con.conname AS name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'c'
      AND ((rel.relname = 'plans'       AND pg_get_constraintdef(con.oid) ~ 'created_by')
        OR (rel.relname = 'plan_items'  AND pg_get_constraintdef(con.oid) ~ 'source')
        OR (rel.relname = 'plan_events' AND pg_get_constraintdef(con.oid) ~ 'actor_type'))
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.name);
  END LOOP;
END $$;

ALTER TABLE plans       ADD CONSTRAINT plans_created_by_check
  CHECK (created_by IN ('ai', 'advisor', 'student'));
ALTER TABLE plan_items  ADD CONSTRAINT plan_items_source_check
  CHECK (source IN ('ai', 'advisor', 'student'));
ALTER TABLE plan_events ADD CONSTRAINT plan_events_actor_type_check
  CHECK (actor_type IN ('ai', 'advisor', 'system', 'student'));

ALTER TABLE plan_events
  ADD COLUMN IF NOT EXISTS student_id INT REFERENCES students(id) ON DELETE SET NULL;

-- 2. Course side panel data (optional)
CREATE TABLE IF NOT EXISTS course_professors (
  id            SERIAL PRIMARY KEY,
  course_id     INT  NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rating        NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
  rating_count  INT,
  difficulty    NUMERIC(2,1) CHECK (difficulty BETWEEN 0 AND 5),
  source_url    TEXT,
  UNIQUE (course_id, name)
);

CREATE TABLE IF NOT EXISTS course_threads (
  id          SERIAL PRIMARY KEY,
  course_id   INT  NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'reddit',
  replies     INT,
  posted_at   TIMESTAMPTZ,
  UNIQUE (course_id, url)
);

CREATE INDEX IF NOT EXISTS idx_course_professors_course ON course_professors (course_id);
CREATE INDEX IF NOT EXISTS idx_course_threads_course ON course_threads (course_id);
