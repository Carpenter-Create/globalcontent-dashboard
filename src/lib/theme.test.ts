import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
  applyTheme,
  nextTheme,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  themeFromRoot,
  themePreferenceFromStorage,
  toggleDocumentTheme,
  toggleTheme,
  type ThemeRoot,
  type ThemeStorage,
} from "./theme";

function fakeRoot(isDark = false): ThemeRoot & { classes: Set<string> } {
  const classes = new Set<string>(isDark ? [THEME_DARK_CLASS] : []);
  return {
    classes,
    classList: {
      contains(token: string) {
        return classes.has(token);
      },
      toggle(token: string, force?: boolean) {
        const on = force ?? !classes.has(token);
        if (on) classes.add(token);
        else classes.delete(token);
        return on;
      },
    },
  };
}

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("theme toggle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats the absence of .dark as light — the default", () => {
    expect(themeFromRoot(fakeRoot(false))).toBe("light");
    expect(themeFromRoot(fakeRoot(true))).toBe("dark");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("writes .dark and gc-theme when toggling to dark", () => {
    const root = fakeRoot(false);
    const storage = fakeStorage();
    expect(toggleTheme("light", root, storage)).toBe("dark");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);
    expect(storage.data[THEME_STORAGE_KEY]).toBe("dark");
  });

  it("clears .dark and persists light when toggling back", () => {
    const root = fakeRoot(true);
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: "dark" });
    expect(toggleTheme("dark", root, storage)).toBe("light");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
  });

  it("still flips the class when storage is unavailable", () => {
    const root = fakeRoot(false);
    expect(applyTheme("dark", root, null)).toBe("dark");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);
  });

  it("keeps the persisted key as gc-theme", () => {
    expect(THEME_STORAGE_KEY).toBe("gc-theme");
  });

  it("toggleDocumentTheme remains available for other callers", () => {
    const root = fakeRoot(false);
    const storage = fakeStorage();
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", storage);
    expect(toggleDocumentTheme()).toBe("dark");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);
    expect(storage.data[THEME_STORAGE_KEY]).toBe("dark");
    expect(toggleDocumentTheme()).toBe("light");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
  });
});

describe("theme preference", () => {
  it("treats a missing or invalid key as light — not system", () => {
    expect(themePreferenceFromStorage(null)).toBe("light");
    expect(themePreferenceFromStorage(undefined)).toBe("light");
    expect(themePreferenceFromStorage("")).toBe("light");
    expect(themePreferenceFromStorage("auto")).toBe("light");
    expect(readThemePreference(fakeStorage())).toBe("light");
  });

  it("reads light, dark, and system from gc-theme", () => {
    expect(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
    expect(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: "system" }))).toBe("system");
  });

  it("resolves system from the OS and leaves explicit light/dark alone", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("persists the stored preference and applies the resolved class", () => {
    const root = fakeRoot(false);
    const storage = fakeStorage();
    expect(setThemePreference("system", root, storage, true)).toBe("system");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("system");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);

    expect(setThemePreference("system", root, storage, false)).toBe("system");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("system");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);

    expect(setThemePreference("light", root, storage, true)).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);
  });
});

describe("no-flash script", () => {
  it("handles dark, system, and unset-as-light in the root layout", () => {
    const layoutSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../app/layout.tsx"),
      "utf8",
    );
    expect(layoutSrc).toContain("localStorage.getItem('gc-theme')");
    expect(layoutSrc).toContain("==='dark'");
    expect(layoutSrc).toContain("==='system'");
    expect(layoutSrc).toContain("prefers-color-scheme: dark");
    expect(layoutSrc).toContain("classList.add('dark')");
    expect(layoutSrc).not.toMatch(/getItem\('gc-theme'\)==='dark'\)\{document/);
  });
});
