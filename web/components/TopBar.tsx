import Image from "next/image";
import { ThemeToggle } from "./ThemeToggle";

// Logo + wordmark, as used in every top bar.
export function Logo() {
  return (
    <div className="flex items-center gap-[10px]">
      <Image src="/logo.png" alt="TasselTrak logo" width={40} height={40} priority className="object-contain" />
      <span className="text-title-18 text-ink-primary">TasselTrak</span>
    </div>
  );
}

// 64px top bar. `tag` sits next to the logo, `children` and the theme toggle are right-aligned.
// `surface` gives the bar its own card background and bottom border (signed-in screens).
export function TopBar({
  surface = false,
  tag,
  children,
}: {
  surface?: boolean;
  tag?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header
      className={`relative z-10 flex h-16 flex-none items-center justify-between gap-4 px-6 ${
        surface ? "border-b-[1.5px] border-border-subtle bg-surface-card" : ""
      }`}
    >
      <div className="flex items-center gap-4">
        <Logo />
        {tag}
      </div>
      <div className="flex min-w-0 items-center gap-[14px]">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
