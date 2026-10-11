"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Sun (switch to light) or moon (switch to dark). Drawn with the text colour, so it follows the theme.
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {theme === "dark" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </>
      ) : (
        <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.6 8.6 0 1 0 20.5 15.2Z" />
      )}
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("tasseltrak-theme");
    const initial: Theme = saved === "light" || saved === "dark" ? saved : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("tasseltrak-theme", next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex cursor-pointer items-center gap-2 rounded-pill border-[1.5px] border-border-default bg-surface-card px-[14px] py-[9px] text-caption-12 whitespace-nowrap text-ink-primary transition-transform hover:-translate-y-0.5"
    >
      <ThemeIcon theme={theme} />
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
