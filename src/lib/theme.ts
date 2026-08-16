// Light/dark preference. Light is the default base; dark is opt-in via the
// `.dark` class on <html> and the `gc-theme` localStorage key. The no-flash
// script in app/layout.tsx reads the same key before paint.

export const THEME_STORAGE_KEY = "gc-theme";
export const THEME_DARK_CLASS = "dark";

export type Theme = "light" | "dark";

export type ThemeRoot = {
  classList: {
    contains(token: string): boolean;
    toggle(token: string, force?: boolean): unknown;
  };
};

export type ThemeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function themeFromRoot(root: ThemeRoot): Theme {
  return root.classList.contains(THEME_DARK_CLASS) ? "dark" : "light";
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(next: Theme, root: ThemeRoot, storage: ThemeStorage | null): Theme {
  root.classList.toggle(THEME_DARK_CLASS, next === "dark");
  try {
    storage?.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode) — the class still flips for
    // the session; it just will not persist.
  }
  return next;
}

export function toggleTheme(current: Theme, root: ThemeRoot, storage: ThemeStorage | null): Theme {
  return applyTheme(nextTheme(current), root, storage);
}

export function toggleDocumentTheme(): Theme {
  let storage: ThemeStorage | null = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  return toggleTheme(themeFromRoot(document.documentElement), document.documentElement, storage);
}
