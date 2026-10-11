import Image from "next/image";

const ICONS = { empty: "/advisor/state-empty.svg", error: "/advisor/state-error.svg" };

// Centred icon, message and action for an empty or failed area. Errors are announced.
export function StateMessage({
  kind,
  children,
  action,
  className = "",
}: {
  kind: keyof typeof ICONS;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex w-full flex-col items-center justify-center gap-4 px-6 py-10 short:py-6 ${className}`}
    >
      <span className="flex size-14 flex-none items-center justify-center rounded-pill bg-surface-sunken">
        <Image src={ICONS[kind]} alt="" width={26} height={26} />
      </span>
      <p className="text-center text-body-16 text-ink-primary">{children}</p>
      {action}
    </div>
  );
}

// Grey placeholder block for loading layouts. Size and radius come from `className` / `width`.
export function Skeleton({ className = "", width }: { className?: string; width?: number }) {
  return <span aria-hidden="true" style={{ width }} className={`block shrink-0 bg-border-subtle ${className}`} />;
}
