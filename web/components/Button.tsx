import Link from "next/link";

const PRIMARY =
  "flex w-full cursor-pointer items-center justify-center rounded-pill bg-ink-primary px-[22px] py-3 text-label-14 text-surface-card transition-colors hover:bg-brand-gold hover:text-ink-on-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-ink-primary disabled:hover:text-surface-card";

// Full-width primary pill button.
export function Button({ className = "", ...props }: React.ComponentProps<"button">) {
  return <button {...props} className={`${PRIMARY} ${className}`} />;
}

// Same look, for navigation.
export function ButtonLink({ className = "", ...props }: React.ComponentProps<typeof Link>) {
  return <Link {...props} className={`${PRIMARY} ${className}`} />;
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
