# Databricks notebook source
# MAGIC %md
# MAGIC # TasselTrak: student risk scores (weighted-v1)
# MAGIC
# MAGIC Pipeline: **Neon Postgres -> Delta tables (workspace.tasseltrak) -> Spark SQL features and score -> upsert back to Neon `student_risk_scores`**.
# MAGIC
# MAGIC - Transparent weighted score. Every factor's raw value, weight and contribution is stored in `factors`.
# MAGIC - No demographic features. Only academic history, load and advisor flags.
# MAGIC - **Advisory only.** The score informs an advising conversation. It never restricts enrollment.
# MAGIC - All students are synthetic. The score reflects the seed generator's rules, so no accuracy numbers are claimed.
# MAGIC - The Neon connection string is read from the `NEON_URL` environment variable (set it in a throwaway cell, see cell 3). Never commit it. Clear cell output before sharing.

# COMMAND ----------

# 1. Install the Postgres driver (pg8000 works on serverless; psycopg2 crashes)
%pip install pg8000

# COMMAND ----------

# 2. Restart Python so the install is picked up
dbutils.library.restartPython()

# COMMAND ----------

# 3. Set the Neon string for this session. Paste the DIRECT (unpooled) string, run the cell,
#    then delete the string from the cell and clear the cell output. Do not commit it.
#    (When run as a Job this cell is harmless: the NEON_URL job parameter takes priority.)
import os
os.environ["NEON_URL"] = "PASTE_STRING_HERE"
print("set")

# COMMAND ----------

# 4. Connect
import os, json
import pg8000.native
from urllib.parse import urlparse, unquote

# As a Databricks Job, the string arrives as the NEON_URL job parameter (fills this widget).
# Interactively, it falls back to the NEON_URL environment variable set in cell 3.
dbutils.widgets.text("NEON_URL", "")

def _url():
    v = dbutils.widgets.get("NEON_URL")
    return v if v else os.environ["NEON_URL"]

def neon():
    u = urlparse(_url())
    return pg8000.native.Connection(
        user=unquote(u.username), password=unquote(u.password),
        host=u.hostname, port=u.port or 5432,
        database=u.path.lstrip("/"), ssl_context=True,
    )

con = neon()
print("connected:", con.run("SELECT current_database(), count(*) FROM students")[0])
con.close()

# COMMAND ----------

# 5. Parameters (adjust weights and cuts here)
CAT, SCH = "workspace", "tasseltrak"
T = f"{CAT}.{SCH}"
MODEL_VERSION = "weighted-v1"
CURRENT_TERM = "fall-2026"          # grade NULL in this term = in progress
CREDITS_PER_TERM = 15
WEIGHTS = {
    "pace_shortfall": 0.20,   # credits earned vs expected for terms enrolled
    "non_passing":    0.25,   # unresolved D, F, W (C or better is required)
    "gpa_decline":    0.08,   # last graded term GPA vs earlier terms
    "retakes":        0.05,   # courses attempted more than once
    "work_hours":     0.07,   # work hours per week above 10
    "load_vs_target": 0.05,   # in-progress credits above target_credits
    "open_flags":     0.30,   # open advisor flags weighted by severity
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9
CUT_MEDIUM, CUT_HIGH = 0.25, 0.50   # below CUT_MEDIUM low, below CUT_HIGH medium, else high
print("ok")

# COMMAND ----------

# 6. Land Neon tables as Delta tables (all columns as strings; typed in Spark SQL below)
from pyspark.sql.types import StructType, StructField, StringType

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {T}")

def land(name):
    c = neon()
    rows = c.run(f"SELECT * FROM {name}")
    cols = [x["name"] for x in c.columns]
    c.close()
    data = [tuple(None if v is None else str(v) for v in r) for r in rows]
    schema = StructType([StructField(x, StringType(), True) for x in cols])
    spark.createDataFrame(data, schema).write.mode("overwrite") \
        .option("overwriteSchema", "true").saveAsTable(f"{T}.{name}")
    print(f"{name}: {len(data)} rows landed")

for t in ["students", "completed_courses", "courses", "student_flags",
          "plans", "plan_items", "sections", "terms", "course_dfw"]:
    try:
        land(t)
    except Exception as e:
        print(f"{t}: FAILED -> {e}")

# COMMAND ----------

# 7. Features in Spark SQL
spark.sql(f"""
CREATE OR REPLACE TEMP VIEW v_terms AS
SELECT CAST(id AS INT) AS term_id, code, lower(season) AS season,
       CAST(year AS INT) * 10 + CASE lower(season) WHEN 'spring' THEN 1 WHEN 'summer' THEN 2 ELSE 3 END AS tidx
FROM {T}.terms
""")

spark.sql(f"""
CREATE OR REPLACE TEMP VIEW v_cc AS
SELECT CAST(c.student_id AS INT) AS sid, CAST(c.course_id AS INT) AS course_id,
       t.tidx, c.grade, CAST(k.credits AS DOUBLE) AS credits,
       c.grade IN ('A+','A','A-','B+','B','B-','C+','C','TC','P','S') AS passing,
       CASE c.grade WHEN 'A+' THEN 4.0 WHEN 'A' THEN 4.0 WHEN 'A-' THEN 3.7 WHEN 'B+' THEN 3.3
            WHEN 'B' THEN 3.0 WHEN 'B-' THEN 2.7 WHEN 'C+' THEN 2.3 WHEN 'C' THEN 2.0
            WHEN 'C-' THEN 1.7 WHEN 'D+' THEN 1.3 WHEN 'D' THEN 1.0 WHEN 'D-' THEN 0.7
            WHEN 'F' THEN 0.0 END AS gp
FROM {T}.completed_courses c
JOIN {T}.courses k ON CAST(k.id AS INT) = CAST(c.course_id AS INT)
JOIN v_terms t ON t.term_id = CAST(c.term_id AS INT)
""")

spark.sql("""
CREATE OR REPLACE TEMP VIEW v_gpa AS
WITH tg AS (
  SELECT sid, tidx, SUM(gp * credits) AS qp, SUM(credits) AS cr
  FROM v_cc WHERE gp IS NOT NULL AND credits > 0 GROUP BY sid, tidx
)
SELECT sid,
       MAX_BY(qp / NULLIF(cr, 0), tidx) AS last_gpa,
       (SUM(qp) - MAX_BY(qp, tidx)) / NULLIF(SUM(cr) - MAX_BY(cr, tidx), 0) AS prior_gpa
FROM tg GROUP BY sid
""")

spark.sql("""
CREATE OR REPLACE TEMP VIEW v_retake AS
SELECT sid, COUNT(*) AS retakes FROM (
  SELECT sid, course_id FROM v_cc WHERE grade IS NULL OR grade <> 'TC'
  GROUP BY sid, course_id HAVING COUNT(*) > 1
) GROUP BY sid
""")

# Non-passing results with no later passing attempt of the same course
# (resolved retakes are captured by the retakes factor instead).
spark.sql("""
CREATE OR REPLACE TEMP VIEW v_unres AS
SELECT np.sid, COUNT(*) AS unresolved FROM v_cc np
WHERE np.grade IS NOT NULL AND NOT np.passing
  AND NOT EXISTS (SELECT 1 FROM v_cc p WHERE p.sid = np.sid AND p.course_id = np.course_id
                  AND p.passing AND p.tidx > np.tidx)
GROUP BY np.sid
""")

spark.sql(f"""
CREATE OR REPLACE TEMP VIEW v_flagsum AS
SELECT CAST(student_id AS INT) AS sid, COUNT(*) AS n_flags,
       SUM(CASE lower(severity) WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.5 ELSE 0.25 END) AS flag_pts
FROM {T}.student_flags
WHERE lower(coalesce(status, 'open')) NOT IN ('resolved', 'dismissed', 'closed', 'done')
GROUP BY CAST(student_id AS INT)
""")

spark.sql(f"""
CREATE OR REPLACE TEMP VIEW v_feat AS
SELECT CAST(s.id AS INT) AS sid, s.external_id, s.display_name,
  COALESCE(a.earned, 0) AS earned_credits,
  COALESCE(e.elapsed, 0) * {CREDITS_PER_TERM} AS expected_credits,
  COALESCE(u.unresolved, 0) AS non_passing_count,
  COALESCE(g.last_gpa - g.prior_gpa, 0) AS gpa_change,
  COALESCE(r.retakes, 0) AS retake_count,
  COALESCE(CAST(s.work_hours_per_week AS DOUBLE), 0) AS work_hours,
  COALESCE(a.inprog, 0) AS inprogress_credits,
  COALESCE(CAST(s.target_credits AS DOUBLE), 15) AS target_credits,
  COALESCE(f.n_flags, 0) AS open_flag_count,
  COALESCE(f.flag_pts, 0) AS flag_points
FROM {T}.students s
LEFT JOIN (
  SELECT sid,
         SUM(CASE WHEN passing THEN credits ELSE 0 END) AS earned,
         SUM(CASE WHEN grade IS NULL THEN credits ELSE 0 END) AS inprog
  FROM v_cc GROUP BY sid) a ON a.sid = CAST(s.id AS INT)
LEFT JOIN (
  SELECT CAST(st.id AS INT) AS sid, COUNT(t.term_id) AS elapsed
  FROM {T}.students st
  JOIN v_terms et ON et.term_id = CAST(st.entry_term_id AS INT)
  JOIN v_terms t ON t.season IN ('fall','spring') AND t.tidx >= et.tidx
       AND t.tidx < (SELECT tidx FROM v_terms WHERE code = '{CURRENT_TERM}')
  GROUP BY CAST(st.id AS INT)) e ON e.sid = CAST(s.id AS INT)
LEFT JOIN v_gpa g ON g.sid = CAST(s.id AS INT)
LEFT JOIN v_retake r ON r.sid = CAST(s.id AS INT)
LEFT JOIN v_flagsum f ON f.sid = CAST(s.id AS INT)
LEFT JOIN v_unres u ON u.sid = CAST(s.id AS INT)
""")

display(spark.sql("SELECT * FROM v_feat ORDER BY sid"))

# COMMAND ----------

# 8. Score = sum(weight * normalized factor), each factor normalized to 0..1
W = WEIGHTS
scored = spark.sql("""
SELECT *,
  LEAST(1.0, GREATEST(0.0, expected_credits - earned_credits) / 30.0)        AS n_pace_shortfall,
  LEAST(1.0, non_passing_count / 2.0)                                        AS n_non_passing,
  LEAST(1.0, GREATEST(0.0, -gpa_change) / 1.5)                               AS n_gpa_decline,
  LEAST(1.0, retake_count / 2.0)                                             AS n_retakes,
  LEAST(1.0, GREATEST(0.0, work_hours - 10) / 25.0)                          AS n_work_hours,
  LEAST(1.0, GREATEST(0.0, inprogress_credits - target_credits) / 6.0)      AS n_load_vs_target,
  LEAST(1.0, flag_points / 1.5)                                              AS n_open_flags
FROM v_feat
""")

RAW = {  # raw value shown next to each factor
    "pace_shortfall": lambda r: {"earned_credits": r["earned_credits"], "expected_credits": r["expected_credits"]},
    "non_passing":    lambda r: {"unresolved_count": r["non_passing_count"]},
    "gpa_decline":    lambda r: {"gpa_change": round(r["gpa_change"], 2)},
    "retakes":        lambda r: {"count": r["retake_count"]},
    "work_hours":     lambda r: {"hours_per_week": r["work_hours"]},
    "load_vs_target": lambda r: {"inprogress_credits": r["inprogress_credits"], "target_credits": r["target_credits"]},
    "open_flags":     lambda r: {"count": r["open_flag_count"], "severity_points": r["flag_points"]},
}

results = []
for row in scored.collect():
    r = row.asDict()
    factors, score = {}, 0.0
    for k, w in W.items():
        norm = float(r[f"n_{k}"])
        contrib = norm * w
        score += contrib
        factors[k] = {"raw": RAW[k](r), "score": round(norm, 3), "weight": w, "contribution": round(contrib, 3)}
    score = round(min(1.0, max(0.0, score)), 3)
    level = "low" if score < CUT_MEDIUM else ("medium" if score < CUT_HIGH else "high")
    results.append({"sid": r["sid"], "name": r["display_name"], "ext": r["external_id"],
                    "score": score, "level": level, "factors": factors})

results.sort(key=lambda x: -x["score"])
for x in results:
    top = sorted(x["factors"].items(), key=lambda kv: -kv[1]["contribution"])[:2]
    print(f'{x["ext"]} {x["name"]:<20} {x["score"]:.3f} {x["level"]:<6} ' +
          ", ".join(f'{k}={v["contribution"]}' for k, v in top))

# COMMAND ----------

# 9. Idempotent upsert into Neon (overall rows: course_id NULL)
UPSERT = """
INSERT INTO student_risk_scores (student_id, course_id, risk_score, risk_level, factors, model_version, computed_at)
VALUES (:sid, NULL, :score, :level, CAST(:factors AS jsonb), :mv, NOW())
ON CONFLICT (student_id, (COALESCE(course_id, 0)), model_version)
DO UPDATE SET risk_score = EXCLUDED.risk_score, risk_level = EXCLUDED.risk_level,
              factors = EXCLUDED.factors, computed_at = NOW()
"""
c = neon()
try:
    c.run("BEGIN")
    for x in results:
        c.run(UPSERT, sid=x["sid"], score=x["score"], level=x["level"],
              factors=json.dumps(x["factors"], default=float), mv=MODEL_VERSION)
    c.run("COMMIT")
    print(f"upserted {len(results)} rows")
except Exception as e:
    c.run("ROLLBACK")
    raise
finally:
    c.close()

# COMMAND ----------

# 10. Verify in Neon and print the demo summary
c = neon()
n = c.run("SELECT count(*) FROM student_risk_scores WHERE course_id IS NULL AND model_version = :mv", mv=MODEL_VERSION)[0][0]
dist = c.run("SELECT risk_level, count(*) FROM student_risk_latest GROUP BY 1 ORDER BY 1")
top5 = c.run("""SELECT s.external_id, s.display_name, l.risk_score, l.risk_level, l.factors
                FROM student_risk_latest l JOIN students s ON s.id = l.student_id
                ORDER BY l.risk_score DESC LIMIT 5""")
c.close()

print("overall rows:", n)
print("level distribution:", dict(dist))
print("top 5:")
for ext, name, sc, lv, f in top5:
    f = f if isinstance(f, dict) else json.loads(f)
    why = ", ".join(f"{k} +{v['contribution']}" for k, v in
                    sorted(f.items(), key=lambda kv: -kv[1]["contribution"])[:3] if v["contribution"] > 0)
    print(f"  {ext} {name}: {float(sc):.3f} {lv} | {why}")

# COMMAND ----------

# 11. Sanity check against the seed storylines (read-only; no scores are hard-coded)
c = neon()
rows = c.run("""SELECT s.external_id, s.display_name, l.risk_score, l.risk_level
                FROM student_risk_latest l JOIN students s ON s.id = l.student_id
                ORDER BY l.risk_score DESC""")
c.close()
for ext, name, sc, lv in rows:
    print(f"{ext} {name:<20} {float(sc):.3f} {lv}")

EXPECT_HIGH = ["Sofia Ramirez", "Aisha Rahman", "Carlos Mendes", "Marcus Webb", "Owen Fisher", "Daniel Kim", "Ethan Park"]
EXPECT_LOW = ["Jordan Ellis", "Maya Okonkwo", "Priya Nair", "Hannah Cole", "Zoe Alvarez",
              "Kwame Mensah", "Tessa Whitman", "Tyrone Jackson", "Noah Brennan"]
by = {n: float(sc) for _, n, sc, _ in rows}
lo_min = min(by[n] for n in EXPECT_HIGH)
hi_max = max(by[n] for n in EXPECT_LOW)
print(f"\nmin(expected-high) = {lo_min:.3f}, max(expected-low) = {hi_max:.3f}")
print("RANKING OK" if lo_min > hi_max else "RANKING DISAGREES: tune WEIGHTS in cell 5")
