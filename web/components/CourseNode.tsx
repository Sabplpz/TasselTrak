import Image from "next/image";

export type CourseState = "taken" | "in-progress" | "available" | "locked" | "suggested";

// State is carried by icon + label + border style, not colour alone.
const STATES: Record<CourseState, { box: string; icon: string; label: string }> = {
  taken: {
    box: "border-[1.5px] border-border-default bg-surface-card shadow-note",
    icon: "/login/icon-taken.svg",
    label: "Taken",
  },
  "in-progress": {
    box: "border-[2.5px] border-ink-primary bg-surface-card shadow-note",
    icon: "/login/icon-in-progress.svg",
    label: "In progress",
  },
  available: {
    box: "border-[2.5px] border-brand-gold bg-brand-gold-soft shadow-note-lifted",
    icon: "/login/icon-available.svg",
    label: "Available now",
  },
  locked: {
    box: "border-[1.5px] border-dashed border-ink-secondary bg-surface-sunken",
    icon: "/login/icon-locked.svg",
    label: "Locked",
  },
  // A course the planner proposed and nobody has confirmed yet: dashed gold, with the "Suggested" tag.
  suggested: {
    box: "border-[1.5px] border-dashed border-brand-gold bg-brand-gold-soft",
    icon: "/login/icon-available.svg",
    label: "Available now",
  },
};

export function SuggestedTag() {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-pill border-[1.5px] border-brand-gold bg-brand-gold-soft py-[3px] pl-[7px] pr-[10px] text-caption-12 whitespace-nowrap text-ink-primary">
      <Image src="/plan/suggested.svg" alt="" width={16} height={16} />
      Suggested
    </span>
  );
}

// Course sticky note, 208 x 108. `status` replaces the state's default label (e.g. "Needs COP 3503"),
// `grade` shows a pill on taken courses, `selected` adds the gold focus ring, and `blocked` swaps a
// suggested course's icon for the lock when it can't be taken yet.
export function CourseNode({
  code,
  title,
  state,
  status,
  grade,
  credits,
  selected = false,
  blocked = false,
}: {
  code: string;
  title: string;
  state: CourseState;
  status?: string;
  grade?: string | null;
  credits?: string;
  selected?: boolean;
  blocked?: boolean;
}) {
  const look = STATES[state];
  const locked = state === "locked";
  const tone = locked ? "text-ink-secondary" : "text-ink-primary";

  return (
    <div className={`relative flex h-[108px] w-[208px] flex-col justify-between rounded-card px-4 py-[14px] ${look.box}`}>
      {state === "suggested" && (
        <span className="absolute -top-[13px] right-2">
          <SuggestedTag />
        </span>
      )}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
        <p className={`truncate text-label-16 ${tone}`}>{code}</p>
        {credits && (
          <p className={`flex-none text-caption-12-regular ${locked ? "text-ink-secondary" : "text-ink-muted"}`}>
            {credits}
          </p>
        )}
      </div>
      <p className="truncate text-body-13 text-ink-secondary">{title}</p>
      <div className="flex min-h-[30px] items-center justify-between gap-2 pt-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Image src={blocked ? STATES.locked.icon : look.icon} alt="" width={18} height={18} className="flex-none" />
          <p className={`truncate text-caption-12 ${tone}`}>{status ?? look.label}</p>
        </div>
        {grade && (
          <span className="flex-none rounded-pill bg-ink-primary px-[9px] py-0.5 text-caption-12 text-surface-card">
            {grade}
          </span>
        )}
      </div>
      {selected && (
        <span className="pointer-events-none absolute -inset-2 rounded-[22px] border-4 border-brand-gold" />
      )}
    </div>
  );
}
