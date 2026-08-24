import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NO_FLASH_THEME_SCRIPT,
  THEME_DARK_CLASS,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyDocumentThemePreference,
  applyTheme,
  applyThemePreference,
  isThemePreference,
  nextTheme,
  preferenceFromStorage,
  resolveTheme,
  themeFromRoot,
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

  it("toggleDocumentTheme still flips .dark + gc-theme", () => {
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

describe("theme preference — Light, Dark, Auto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads light as the default and accepts only the three stored values", () => {
    expect(THEME_PREFERENCES).toEqual(["light", "dark", "auto"]);
    expect(preferenceFromStorage(fakeStorage())).toBe("light");
    expect(preferenceFromStorage(null)).toBe("light");
    expect(preferenceFromStorage(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(preferenceFromStorage(fakeStorage({ [THEME_STORAGE_KEY]: "auto" }))).toBe("auto");
    expect(preferenceFromStorage(fakeStorage({ [THEME_STORAGE_KEY]: "system" }))).toBe("light");
    expect(isThemePreference("auto")).toBe(true);
    expect(isThemePreference("system")).toBe(false);
  });

  it("resolves Auto from the device preference and leaves Light/Dark explicit", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("writes auto to gc-theme and applies the resolved class", () => {
    const root = fakeRoot(false);
    const storage = fakeStorage();
    expect(applyThemePreference("auto", root, storage, true)).toBe("dark");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("auto");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);
    expect(applyThemePreference("auto", root, storage, false)).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("auto");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);
  });

  it("applyDocumentThemePreference uses the existing key and matchMedia", () => {
    const root = fakeRoot(false);
    const storage = fakeStorage();
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    expect(applyDocumentThemePreference("auto")).toBe("dark");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("auto");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(true);
    expect(applyDocumentThemePreference("light")).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
    expect(root.classes.has(THEME_DARK_CLASS)).toBe(false);
  });

  it("no-flash script applies dark and Auto without adopting the OS by default", () => {
    expect(NO_FLASH_THEME_SCRIPT).toContain("gc-theme");
    expect(NO_FLASH_THEME_SCRIPT).toContain("==='dark'");
    expect(NO_FLASH_THEME_SCRIPT).toContain("==='auto'");
    expect(NO_FLASH_THEME_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(NO_FLASH_THEME_SCRIPT).not.toContain("==='light'");
  });
});
