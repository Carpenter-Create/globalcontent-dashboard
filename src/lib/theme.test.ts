import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
  applyTheme,
  nextTheme,
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

  it("toggleDocumentTheme is the Appearance action: .dark + gc-theme", () => {
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
