// Databricks smoke test for TasselTrak (runs on your laptop, no packages needed).
// Run from the repo root (needs Node 20.6+):
//   node --env-file=web/.env.local scripts/test-databricks.mjs
//
// Checks that DATABRICKS_HOST, DATABRICKS_TOKEN and DATABRICKS_HTTP_PATH work together
// by running one query on your SQL warehouse through the SQL Statement Execution API.

const host = (process.env.DATABRICKS_HOST || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const token = process.env.DATABRICKS_TOKEN;
const httpPath = process.env.DATABRICKS_HTTP_PATH || "";
const warehouseId = httpPath.split("/").filter(Boolean).pop();

const missing = [
  !host && "DATABRICKS_HOST",
  !token && "DATABRICKS_TOKEN",
  !warehouseId && "DATABRICKS_HTTP_PATH",
].filter(Boolean);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}. Put them in web/.env.local and run with --env-file=web/.env.local`);
  process.exit(1);
}

const base = `https://${host}/api/2.0/sql/statements`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

console.log(`Host:          ${host}`);
console.log(`Warehouse id:  ${warehouseId}\n`);

let res;
try {
  res = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: "SELECT 1 AS ok, current_user() AS who, current_catalog() AS catalog",
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
    }),
  });
} catch (err) {
  console.error("FAIL: could not reach the host. Check DATABRICKS_HOST (no https://, no path).");
  console.error(String(err));
  process.exit(1);
}

let body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`FAIL: HTTP ${res.status}`);
  console.error(JSON.stringify(body).slice(0, 600));
  if (res.status === 401 || res.status === 403) console.error("-> The token is wrong, expired or revoked. Generate a new one.");
  if (res.status === 404) console.error("-> Warehouse id not found. Re-copy the HTTP path from SQL Warehouses > Connection details.");
  process.exit(1);
}

// The warehouse may still be starting: poll for up to ~60 s.
for (let i = 0; i < 12 && ["PENDING", "RUNNING"].includes(body.status?.state); i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const poll = await fetch(`${base}/${body.statement_id}`, { headers });
  body = await poll.json().catch(() => body);
  console.log(`  waiting... state: ${body.status?.state}`);
}

if (body.status?.state === "SUCCEEDED") {
  const [ok, who, catalog] = body.result?.data_array?.[0] ?? [];
  console.log("PASS: Databricks credentials work.");
  console.log(`  query returned ok=${ok}, user=${who}, catalog=${catalog}`);
} else {
  console.error(`FAIL: statement ended in state ${body.status?.state}`);
  console.error(JSON.stringify(body.status?.error ?? body).slice(0, 600));
  process.exit(1);
}
