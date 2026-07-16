"use client";

import { useSyncExternalStore } from "react";

// Light/dark toggle. Light is the default base; this flips the `.dark` class on
// <html> and persists the choice. The no-flash script in layout.tsx applies the
// stored preference before paint.
//
// State is read straight from the DOM via useSyncExternalStore (no setState in
// an effect): a MutationObserver on <html>'s class keeps the button in sync,
// and getServerSnapshot returns "light" to match SSR (the class is only added
// on the client), avoiding hydration mismatch.

type Theme = "light" | "dark";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("gc-theme", next);
    } catch {
      // Storage may be unavailable (private mode) — the toggle still works for
      // the session; it just won't persist. The MutationObserver re-renders us.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-hairline text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink"
    >
      {/* Sun / moon glyphs, stroke-only to match the hairline register. */}
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
