// Theme preference vs resolved class. Light is the default base when the
// `gc-theme` key is missing or invalid. `system` follows the OS only when
// the user chooses it — unset is not system. The no-flash script in
// app/layout.tsx reads the same key before paint.

export const THEME_STORAGE_KEY = "gc-theme";
export const THEME_DARK_CLASS = "dark";
export const THEME_CHANGE_EVENT = "gc-theme-change";

export type Theme = "light" | "dark";
export type ThemePreference = "light" | "dark" | "system";

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

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function themePreferenceFromStorage(stored: string | null | undefined): ThemePreference {
  return isThemePreference(stored) ? stored : "light";
}

export function readThemePreference(storage: ThemeStorage | null): ThemePreference {
  try {
    return themePreferenceFromStorage(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return "light";
  }
}

export function themeFromRoot(root: ThemeRoot): Theme {
  return root.classList.contains(THEME_DARK_CLASS) ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyResolvedTheme(resolved: Theme, root: ThemeRoot): Theme {
  root.classList.toggle(THEME_DARK_CLASS, resolved === "dark");
  return resolved;
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

function writePreference(preference: ThemePreference, storage: ThemeStorage | null): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode) — the class still flips for
    // the session; it just will not persist.
  }
}

export function setThemePreference(
  preference: ThemePreference,
  root: ThemeRoot,
  storage: ThemeStorage | null,
  systemPrefersDark: boolean,
): ThemePreference {
  writePreference(preference, storage);
  applyResolvedTheme(resolveTheme(preference, systemPrefersDark), root);
  return preference;
}

export function applyTheme(next: Theme, root: ThemeRoot, storage: ThemeStorage | null): Theme {
  setThemePreference(next, root, storage, false);
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

export function setDocumentThemePreference(preference: ThemePreference): ThemePreference {
  let storage: ThemeStorage | null = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  const systemPrefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = setThemePreference(
    preference,
    document.documentElement,
    storage,
    systemPrefersDark,
  );
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  return next;
}
