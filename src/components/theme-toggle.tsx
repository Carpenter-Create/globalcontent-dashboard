"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  THEME_CHANGE_EVENT,
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  themeFromRoot,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";

// Reads the live `.dark` class on <html>. Light is the default base; the
// no-flash script in layout.tsx applies a stored `gc-theme` before paint.
//
// State is read straight from the DOM via useSyncExternalStore (no setState in
// an effect): a MutationObserver on <html>'s class keeps the glyph in sync,
// and getServerSnapshot returns "light" to match SSR (the class is only added
// on the client), avoiding hydration mismatch.

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return themeFromRoot(document.documentElement);
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getPreferenceSnapshot(): ThemePreference {
  try {
    return readThemePreference(localStorage);
  } catch {
    return "light";
  }
}

function subscribePreference(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribePreference, getPreferenceSnapshot, getServerSnapshot);
}

/** When the stored choice is system, keep `.dark` in sync with the OS. */
export function useSystemThemeSync(preference: ThemePreference): void {
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      applyResolvedTheme(resolveTheme("system", media.matches), document.documentElement);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
}

export function ThemeGlyph({ className }: { className?: string }) {
  const isDark = useTheme() === "dark";

  return isDark ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
