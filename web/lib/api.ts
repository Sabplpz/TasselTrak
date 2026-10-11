import { NextResponse } from "next/server";

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

// Same as fail(), with a machine-readable `code` the frontend can switch on to pick a Figma state.
export const failCode = (code: string, error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status });

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

// Errors that carry an HTTP status and a code (for example a planner timeout).
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function serverError(err: unknown) {
  if (err instanceof ApiError) return failCode(err.code, err.message, err.status, err.extra);
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg, code: "server_error" }, { status: 500 });
}
