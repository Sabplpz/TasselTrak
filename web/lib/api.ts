import { NextResponse } from "next/server";

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

export function toId(v: string | null | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

export function serverError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg }, { status: 500 });
}
