import { sql } from "@/lib/db";

// A term's position on the calendar. Spring < summer < fall inside a year.
const SEASON_ORDER: Record<string, number> = { spring: 1, summer: 2, fall: 3 };

export type Term = { id: number; code: string; name: string; season: string; year: number; key: number };

export const termKey = (season: string, year: number) => year * 10 + (SEASON_ORDER[season] ?? 0);

export async function allTerms(): Promise<Term[]> {
  const rows = (await sql`SELECT id, code, name, season, year FROM terms ORDER BY year,
      CASE season WHEN 'spring' THEN 1 WHEN 'summer' THEN 2 ELSE 3 END`) as any[];
  return rows.map((r) => ({ ...r, key: termKey(r.season, r.year) }));
}

export const byCode = (terms: Term[], code: string) => terms.find((t) => t.code === code) ?? null;
export const byId = (terms: Term[], id: number) => terms.find((t) => t.id === id) ?? null;

// The term before `planTerm` is the one students are in right now ("Now" tag in the Figma).
export function currentTermOf(terms: Term[], planTerm: Term): Term | null {
  const before = terms.filter((t) => t.key < planTerm.key);
  return before[before.length - 1] ?? null;
}

// The next `count` terms after `afterKey`, skipping summer.
export function termsAfter(terms: Term[], afterKey: number, count: number): Term[] {
  return terms.filter((t) => t.key > afterKey && t.season !== "summer").slice(0, count);
}

export const fmtGroup = (g: string[]) => (g.length > 1 ? `one of ${g.join(" / ")}` : g[0]);
