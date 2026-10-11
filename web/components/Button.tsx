import Link from "next/link";

const BASE =
  "flex cursor-pointer items-center justify-center rounded-pill px-[22px] text-label-14 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-70";

const VARIANTS = {
  primary:
    "bg-ink-primary py-3 text-surface-card hover:bg-brand-gold hover:text-ink-on-gold disabled:hover:bg-ink-primary disabled:hover:text-surface-card",
  secondary: "border-[1.5px] border-border-default py-3 text-ink-primary hover:border-ink-primary",
};

type Look = { variant?: keyof typeof VARIANTS; full?: boolean };

const look = ({ variant = "primary", full = true }: Look, className = "") =>
  `${BASE} ${VARIANTS[variant]} ${full ? "w-full" : ""} ${className}`;

// Pill button. Full width by default; `full={false}` hugs the label.
export function Button({ variant, full, className, ...props }: React.ComponentProps<"button"> & Look) {
  return <button {...props} className={look({ variant, full }, className)} />;
}

// Same look, for navigation.
export function ButtonLink({ variant, full, className, ...props }: React.ComponentProps<typeof Link> & Look) {
  return <Link {...props} className={look({ variant, full }, className)} />;
}

// Underlined text button, e.g. "Sign out".
export function TextButton({ className = "", ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`cursor-pointer whitespace-nowrap text-label-14 text-ink-primary underline underline-offset-2 hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary ${className}`}
    />
  );
}
