import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (put it in web/.env.local)");
}

// Tagged-template client: await sql`SELECT * FROM courses WHERE id = ${id}`
// Values are sent as parameters, so this is safe from SQL injection.
export const sql = neon(url);
