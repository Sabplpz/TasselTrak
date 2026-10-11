// Test-only stand-in for lib/db.ts: same tagged-template call style as the Neon driver,
// but backed by an in-process Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";

export const pg = new PGlite();

export const sql: any = async (strings: TemplateStringsArray, ...values: any[]) => {
  let text = "";
  strings.forEach((s, i) => {
    text += s + (i < values.length ? `$${i + 1}` : "");
  });
  const res = await pg.query(text, values);
  return res.rows;
};
