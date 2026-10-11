import Image from "next/image";

export type RiskLevel = "low" | "medium" | "high";

const RISK: Record<RiskLevel, { label: string; icon: string; box: string }> = {
  high: {
    label: "High",
    icon: "/advisor/risk-high.svg",
    box: "bg-ink-primary text-surface-card",
  },
  medium: {
    label: "Medium",
    icon: "/advisor/risk-medium.svg",
    box: "border-[1.5px] border-brand-gold bg-brand-gold-soft text-ink-primary",
  },
  low: {
    label: "Low",
    icon: "/advisor/risk-low.svg",
    box: "border-[1.5px] border-border-default bg-surface-card text-ink-secondary",
  },
};

// Risk level as icon + label, so the level never depends on colour alone.
// `detail` is appended after the label, e.g. "High · 78" or "High risk".
export function RiskChip({ level, detail }: { level: RiskLevel | null; detail?: string }) {
  if (!level) {
    return (
      <span className="inline-flex items-center rounded-pill border-[1.5px] border-dashed border-border-default px-3 py-1 text-caption-12 whitespace-nowrap text-ink-secondary">
        Not scored
      </span>
    );
  }
  const risk = RISK[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill py-1 pl-2 pr-3 text-caption-12 whitespace-nowrap ${risk.box}`}
    >
      <Image src={risk.icon} alt="" width={16} height={16} />
      {detail ? `${risk.label} ${detail}` : risk.label}
    </span>
  );
}

// Dark pill: "Advisor" (gold text) in the top bar, "Viewing" on the selected row.
export function Pill({ tone = "light", children }: { tone?: "light" | "gold"; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-pill bg-ink-primary text-caption-12 whitespace-nowrap ${
        tone === "gold" ? "px-[10px] py-[3px] text-brand-gold" : "px-2 py-0.5 text-surface-card"
      }`}
    >
      {children}
    </span>
  );
}

// Small gold note tag, e.g. "Sample data".
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-brand-gold bg-brand-gold-soft px-2 py-0.5 text-caption-12 text-ink-primary">
      {children}
    </span>
  );
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const AVATAR = {
  sm: "size-8 bg-surface-sunken text-caption-12 text-ink-secondary",
  md: "size-9 bg-brand-gold text-label-14 text-ink-primary",
  lg: "size-[52px] bg-surface-sunken text-label-16 text-ink-secondary",
};

// Initials in a circle. sm = table row, md = signed-in user (gold), lg = panel header.
export function Avatar({ name, size = "sm" }: { name: string; size?: keyof typeof AVATAR }) {
  return (
    <span aria-hidden="true" className={`flex flex-none items-center justify-center rounded-pill ${AVATAR[size]}`}>
      {initialsOf(name)}
    </span>
  );
}

export type PlanStatus = "draft" | "in_review" | "approved" | "archived";

const PLAN_STATUS: Record<PlanStatus, { label: string; icon: string | null; box: string }> = {
  draft: {
    label: "Draft",
    icon: "/plan/status-draft.svg",
    box: "border-ink-primary bg-surface-card text-ink-primary",
  },
  in_review: {
    label: "In review",
    icon: "/advisor/eye.svg",
    box: "border-brand-gold bg-brand-gold-soft text-ink-primary",
  },
  approved: {
    label: "Approved",
    icon: "/login/check.svg",
    box: "border-ink-primary bg-ink-primary text-surface-card",
  },
  archived: {
    label: "Archived",
    icon: null,
    box: "border-dashed border-border-default bg-surface-sunken text-ink-secondary",
  },
};

// Plan status as icon + label.
export function PlanStatusChip({ status }: { status: PlanStatus }) {
  const look = PLAN_STATUS[status];
  return (
    <span
      className={`inline-flex flex-none items-center gap-[5px] rounded-pill border-[1.5px] py-[3px] pl-[7px] pr-[10px] text-caption-12 whitespace-nowrap ${look.box}`}
    >
      {look.icon && <Image src={look.icon} alt="" width={16} height={16} />}
      {look.label}
    </span>
  );
}
