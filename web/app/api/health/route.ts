import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// GET /api/health -> confirms the app can reach Neon and the schema is loaded
export async function GET() {
  try {
    const [{ now }] = await sql`SELECT NOW() AS now`;
    const [{ tables }] = await sql`
      SELECT COUNT(*)::int AS tables
      FROM information_schema.tables
      WHERE table_schema = 'public'`;
    return NextResponse.json({ ok: true, now, tables });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
