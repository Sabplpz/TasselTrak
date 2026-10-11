"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

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
      className="flex cursor-pointer items-center gap-2 rounded-pill border-[1.5px] border-border-default bg-surface-card px-[14px] py-[9px] text-caption-12 text-ink-primary transition-transform hover:-translate-y-0.5"
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
