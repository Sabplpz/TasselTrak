import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// GET /api/caseload?advisorId=1 -> caseload list for the advisor dashboard
export async function GET(req: Request) {
  const advisorId = new URL(req.url).searchParams.get("advisorId");
  try {
    const rows = advisorId
      ? await sql`SELECT * FROM student_overview
                  WHERE advisor_id = ${Number(advisorId)}
                  ORDER BY open_flags DESC, display_name`
      : await sql`SELECT * FROM student_overview
                  ORDER BY open_flags DESC, display_name`;
    return NextResponse.json({ students: rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
