// Risk helpers. The stored score is 0..1 (Databricks job); the UI shows 0..100.

// Level cut-offs on the 0..100 scale. The Figma shows 52 as Medium and 69 as High, so the
// default high cut-off is 50. Override with RISK_HIGH_AT / RISK_MEDIUM_AT.
export const HIGH_AT = Number(process.env.RISK_HIGH_AT ?? 50);
export const MEDIUM_AT = Number(process.env.RISK_MEDIUM_AT ?? 25);

export const to100 = (s: number | null | undefined): number | null => (s == null ? null : Math.round(Number(s) * 100));

export const levelOf = (score100: number | null): "low" | "medium" | "high" | null =>
  score100 == null ? null : score100 >= HIGH_AT ? "high" : score100 >= MEDIUM_AT ? "medium" : "low";

// Class standing from graded credits (UCF-style bands).
export const standingOf = (creditsEarned: number): "Freshman" | "Sophomore" | "Junior" | "Senior" =>
  creditsEarned < 30 ? "Freshman" : creditsEarned < 60 ? "Sophomore" : creditsEarned < 90 ? "Junior" : "Senior";

export const ADVISORY_NOTE =
  "Advisory only. This score informs a conversation and never restricts enrollment or blocks a plan. It uses no demographic features.";

type Factor = { key: string; title: string; detail: string; points: number };

const n = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const plural = (c: number, one: string, many = one + "s") => `${c} ${c === 1 ? one : many}`;
const pick = (raw: any, ...keys: string[]) => {
  for (const k of keys) if (raw && raw[k] != null) return n(raw[k]);
  return null;
};
const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Turn the stored factor JSON ({ open_flags: { raw, score, weight, contribution }, ... })
// into the sentences the student panel shows. Known factors get tailored text; anything
// else falls back to its raw values so a new factor in the notebook still renders.
export function explainFactors(factors: Record<string, any> | null | undefined): Factor[] {
  const out: Factor[] = [];
  for (const [key, f] of Object.entries(factors ?? {})) {
    const contribution = n(f?.contribution) ?? 0;
    if (contribution <= 0) continue;
    const raw = f?.raw ?? {};
    let title = humanize(key);
    let detail = "";
    switch (key) {
      case "open_flags": {
        const c = pick(raw, "count") ?? 0;
        title = "Open advising flags";
        detail = `${plural(c, "open flag")} needing attention.`;
        break;
      }
      case "non_passing": {
        const c = pick(raw, "unresolved_count", "count") ?? 0;
        title = "Courses not passed yet";
        detail = `${plural(c, "course")} with a failing or withdrawn grade still unresolved.`;
        break;
      }
      case "pace_shortfall": {
        const e = pick(raw, "earned_credits"), x = pick(raw, "expected_credits");
        title = "Behind expected pace";
        detail = e != null && x != null ? `${e} credits earned against about ${x} expected by now.` : "Fewer credits earned than expected by now.";
        break;
      }
      case "gpa_decline": {
        const a = pick(raw, "from", "start_gpa", "previous_gpa"), b = pick(raw, "to", "end_gpa", "current_gpa");
        title = "GPA trending down";
        detail = a != null && b != null ? `From ${a} to ${b} over recent terms.` : "Recent terms show a lower GPA than earlier ones.";
        break;
      }
      case "retakes": {
        const c = pick(raw, "count", "retake_count");
        title = "Repeated courses";
        detail = c != null ? `${plural(c, "course")} retaken.` : "One or more courses have been retaken.";
        break;
      }
      case "work_hours": {
        const h = pick(raw, "hours", "work_hours_per_week", "hours_per_week");
        title = "Heavy work schedule";
        detail = h != null ? `Works about ${h} hours a week.` : "Works a significant number of hours a week.";
        break;
      }
      case "load_vs_target": {
        title = "Course load vs. target";
        detail = "The current load is far from the student's target credits.";
        break;
      }
      default: {
        const entries = Object.entries(raw).slice(0, 3).map(([k, v]) => `${humanize(k)}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
        detail = entries.join(", ");
      }
    }
    out.push({ key, title, detail, points: Math.round(contribution * 100) });
  }
  return out.sort((a, b) => b.points - a.points);
}

export function summarize(factors: Factor[]): string {
  if (!factors.length) return "No factors are raising this score.";
  const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const [a, b] = factors;
  return b ? `Mainly driven by ${low(a.title)} and ${low(b.title)}.` : `Mainly driven by ${low(a.title)}.`;
}
