// Theme preference. Light is the default base; dark is opt-in via the
// `.dark` class on <html> and the `gc-theme` localStorage key. Auto writes
// the same key and resolves from prefers-color-scheme — it is never the
// default. The no-flash script in app/layout.tsx reads the same key before
// paint. No SQL, auth, or secrets.

export const THEME_STORAGE_KEY = "gc-theme";
export const THEME_DARK_CLASS = "dark";
export const THEME_PREFERENCES = ["light", "dark", "auto"] as const;

export type Theme = "light" | "dark";
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

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

export const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('${THEME_DARK_CLASS}');}}catch(e){}})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "auto";
}

export function preferenceFromStorage(storage: ThemeStorage | null): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === "auto") return prefersDark ? "dark" : "light";
  return preference;
}

export function themeFromRoot(root: ThemeRoot): Theme {
  return root.classList.contains(THEME_DARK_CLASS) ? "dark" : "light";
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

export function applyResolvedTheme(next: Theme, root: ThemeRoot): Theme {
  root.classList.toggle(THEME_DARK_CLASS, next === "dark");
  return next;
}

function persistPreference(preference: ThemePreference, storage: ThemeStorage | null): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode) — the class still flips for
    // the session; it just will not persist.
  }
}

export function applyTheme(next: Theme, root: ThemeRoot, storage: ThemeStorage | null): Theme {
  persistPreference(next, storage);
  return applyResolvedTheme(next, root);
}

export function applyThemePreference(
  preference: ThemePreference,
  root: ThemeRoot,
  storage: ThemeStorage | null,
  prefersDark: boolean,
): Theme {
  persistPreference(preference, storage);
  return applyResolvedTheme(resolveTheme(preference, prefersDark), root);
}

export function toggleTheme(current: Theme, root: ThemeRoot, storage: ThemeStorage | null): Theme {
  return applyTheme(nextTheme(current), root, storage);
}

function documentStorage(): ThemeStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function toggleDocumentTheme(): Theme {
  return toggleTheme(themeFromRoot(document.documentElement), document.documentElement, documentStorage());
}

export const THEME_PREFERENCE_EVENT = "gc-theme-preference";

export function applyDocumentThemePreference(preference: ThemePreference): Theme {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = applyThemePreference(
    preference,
    document.documentElement,
    documentStorage(),
    prefersDark,
  );
  window.dispatchEvent(new Event(THEME_PREFERENCE_EVENT));
  return resolved;
}

export function subscribeThemePreference(callback: () => void): () => void {
  window.addEventListener(THEME_PREFERENCE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_PREFERENCE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function themePreferenceSnapshot(): ThemePreference {
  return preferenceFromStorage(documentStorage());
}
