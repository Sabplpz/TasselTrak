import Link from "next/link";

const BASE =
  "flex cursor-pointer items-center justify-center rounded-pill text-label-14 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS = {
  primary:
    "bg-ink-primary text-surface-card hover:bg-brand-gold hover:text-ink-on-gold disabled:hover:bg-ink-primary disabled:hover:text-surface-card",
  secondary:
    "border-[1.5px] border-border-default text-ink-primary hover:border-ink-primary disabled:hover:border-border-default",
  gold: "border-[1.5px] border-ink-on-gold bg-brand-gold text-ink-on-gold",
};

const SIZES = { md: "px-[22px] py-3", sm: "px-[14px] py-2" };

type Look = { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES; full?: boolean };

const look = ({ variant = "primary", size = "md", full = true }: Look, className = "") =>
  `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`;

// Pill button. Full width by default; `full={false}` hugs the label.
export function Button({ variant, size, full, className, ...props }: React.ComponentProps<"button"> & Look) {
  return <button {...props} className={look({ variant, size, full }, className)} />;
}

// Same look, for navigation.
export function ButtonLink({ variant, size, full, className, ...props }: React.ComponentProps<typeof Link> & Look) {
  return <Link {...props} className={look({ variant, size, full }, className)} />;
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
