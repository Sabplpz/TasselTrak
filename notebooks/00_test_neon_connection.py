# Databricks notebook source
# MAGIC %md
# MAGIC # TasselTrak: can Databricks reach Neon?
# MAGIC
# MAGIC Import this file into your workspace (Workspace > Import), attach serverless compute and run the cells in order.
# MAGIC The result decides whether the notebook writes to Neon directly or we use the fallback
# MAGIC (notebook writes a Delta table, a laptop script copies it into Neon).
# MAGIC
# MAGIC Paste the **direct** (unpooled) Neon connection string into the `NEON_URL` widget at the top.
# MAGIC Do not paste it into a code cell: notebooks get committed.

# COMMAND ----------

# MAGIC %pip install psycopg2-binary

# COMMAND ----------

dbutils.widgets.text("NEON_URL", "")
neon_url = dbutils.widgets.get("NEON_URL").strip()
assert neon_url.startswith("postgres"), "Paste your Neon connection string into the NEON_URL widget first."

# COMMAND ----------

# Step 1: is outbound networking to Neon allowed at all?
import socket
from urllib.parse import urlparse

host = urlparse(neon_url).hostname
port = urlparse(neon_url).port or 5432
print(f"Neon host: {host}")

try:
    ip = socket.getaddrinfo(host, port)[0][4][0]
    print(f"DNS OK -> {ip}")
except Exception as e:
    print(f"DNS FAILED: {e}")
    print("-> Outbound internet is likely still blocked. Finish LinkedIn verification, or use the fallback.")
    raise

try:
    socket.create_connection((host, port), timeout=8).close()
    print(f"TCP connection to port {port} OK")
except Exception as e:
    print(f"TCP connection FAILED: {e}")
    print("-> Outbound internet is likely blocked for this workspace. Use the fallback.")
    raise

# COMMAND ----------

# Step 2: read from Neon
import psycopg2

conn = psycopg2.connect(neon_url)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
print("Neon public tables and views:", cur.fetchone()[0])

# COMMAND ----------

# Step 3: write to Neon (creates and drops a scratch table)
cur.execute("CREATE TABLE IF NOT EXISTS _databricks_ping (id SERIAL PRIMARY KEY, note TEXT, at TIMESTAMPTZ DEFAULT NOW())")
cur.execute("INSERT INTO _databricks_ping (note) VALUES ('hello from databricks') RETURNING id, at")
print("Wrote row:", cur.fetchone())
cur.execute("DROP TABLE _databricks_ping")
conn.commit()
cur.close()
conn.close()
print("PASS: Databricks can read and write Neon. The notebook can write risk scores directly.")
