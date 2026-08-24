import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APP_SHEET_HAIRLINE_CLASS,
  APP_SHEET_HEAD_CLASS,
  APP_SHEET_MOTION_DURATION_MS,
  APP_SHEET_MOTION_EASING,
  APP_SHEET_RISE_CLASS,
  APP_SHEET_SCRIM_CLASS,
  APP_SHEET_SCRIM_FADE_CLASS,
  APP_SHEET_SURFACE_CLASS,
  CLOSE_44_CLASS,
  IDENTITY_AVATAR_CLASS,
  IDENTITY_BLOCK_CLASS,
  IDENTITY_EMAIL_CLASS,
  HOUSE_EMPTY_CLASS,
  IDENTITY_NAME_CLASS,
  SHEET_GROUP_CHEVRON_CLASS,
  SHEET_GROUP_CLASS,
  SHEET_GROUP_ITEM_CLASS,
  SHEET_GROUP_LABEL_CLASS,
  TEXT_ACTION_CLASS,
  THREAD_POPOVER_ICON_CLASS,
} from "./house-sheet";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, "../app/tokens.css"), "utf8");
const globals = readFileSync(join(here, "../app/globals.css"), "utf8");

describe("house sheet lock", () => {
  it("keeps Close/44 on the muted 44 circle", () => {
    expect(CLOSE_44_CLASS).toContain("size-[44px]");
    expect(CLOSE_44_CLASS).toContain("min-h-[44px]");
    expect(CLOSE_44_CLASS).toContain("min-w-[44px]");
    expect(CLOSE_44_CLASS).toContain("rounded-full");
    expect(CLOSE_44_CLASS).toContain("bg-surface-muted");
    expect(CLOSE_44_CLASS).toContain("text-ink-3");
  });

  it("keeps the house empty line on 15 Regular, no card", () => {
    expect(HOUSE_EMPTY_CLASS).toBe("t-body text-ink-2");
    expect(HOUSE_EMPTY_CLASS).not.toContain("border");
    expect(HOUSE_EMPTY_CLASS).not.toContain("rounded");
  });

  it("keeps Text action on 13 Sporty Blue", () => {
    expect(TEXT_ACTION_CLASS).toContain("t-body-sm");
    expect(TEXT_ACTION_CLASS).toContain("font-normal");
    expect(TEXT_ACTION_CLASS).toContain("text-accent");
    expect(TEXT_ACTION_CLASS).not.toContain("bg-accent");
  });

  it("keeps Identity on a 48 circle with no pill well", () => {
    expect(IDENTITY_AVATAR_CLASS).toContain("size-12");
    expect(IDENTITY_AVATAR_CLASS).toContain("rounded-full");
    expect(IDENTITY_AVATAR_CLASS).toContain("bg-surface-muted");
    expect(IDENTITY_BLOCK_CLASS).not.toContain("bg-surface-muted");
    expect(IDENTITY_BLOCK_CLASS).not.toContain("rounded-[");
    expect(IDENTITY_NAME_CLASS).toContain("t-body");
    expect(IDENTITY_NAME_CLASS).toContain("text-ink");
    expect(IDENTITY_EMAIL_CLASS).toContain("t-body-sm");
    expect(IDENTITY_EMAIL_CLASS).toContain("text-ink-3");
  });

  it("keeps Group on 12 tracked ACCOUNT rows and 15 Regular items", () => {
    expect(SHEET_GROUP_CLASS).toContain("gap-[var(--space-6)]");
    expect(SHEET_GROUP_LABEL_CLASS).toContain("uppercase");
    expect(SHEET_GROUP_LABEL_CLASS).toContain("tracking-[0.08em]");
    expect(SHEET_GROUP_ITEM_CLASS).toContain("text-[length:var(--text-base)]");
    expect(SHEET_GROUP_ITEM_CLASS).toContain("text-ink");
    expect(SHEET_GROUP_ITEM_CLASS).toContain("justify-between");
    expect(SHEET_GROUP_CHEVRON_CLASS).toContain("size-4");
    expect(SHEET_GROUP_CHEVRON_CLASS).toContain("text-ink-3");
  });

  it("locks app-sheet chrome to 543:576 — r16, pad 16/24/48, quiet scrim", () => {
    expect(APP_SHEET_SURFACE_CLASS).toContain("rounded-t-[16px]");
    expect(APP_SHEET_SURFACE_CLASS).toContain("px-[var(--space-4)]");
    expect(APP_SHEET_SURFACE_CLASS).toContain("pt-[var(--space-6)]");
    expect(APP_SHEET_SURFACE_CLASS).toContain("pb-[var(--space-12)]");
    expect(APP_SHEET_SURFACE_CLASS).toContain("bg-surface");
    expect(APP_SHEET_SURFACE_CLASS).not.toContain("rounded-t-[24px]");
    expect(APP_SHEET_HEAD_CLASS).toContain("h-[44px]");
    expect(APP_SHEET_HAIRLINE_CLASS).toContain("bg-hairline");
    expect(APP_SHEET_SCRIM_CLASS).toContain("absolute inset-0");
    expect(APP_SHEET_SCRIM_CLASS).toContain("bg-ink/24");
    expect(APP_SHEET_SCRIM_CLASS).toContain(APP_SHEET_SCRIM_FADE_CLASS);
    expect(APP_SHEET_SURFACE_CLASS).toContain(APP_SHEET_RISE_CLASS);
  });

  it("houses one 300–360ms ease-out rise for nav and account — no bounce, no slide when reduced", () => {
    expect(APP_SHEET_MOTION_DURATION_MS).toBeGreaterThanOrEqual(300);
    expect(APP_SHEET_MOTION_DURATION_MS).toBeLessThanOrEqual(360);
    expect(APP_SHEET_MOTION_EASING).toBe("ease-out");
    expect(APP_SHEET_MOTION_EASING).not.toMatch(/bounce|spring|elastic|in-out/i);
    expect(APP_SHEET_RISE_CLASS).toBe("app-sheet-rise");
    expect(APP_SHEET_SCRIM_FADE_CLASS).toBe("app-sheet-scrim-fade");
    expect(APP_SHEET_SURFACE_CLASS).toContain(APP_SHEET_RISE_CLASS);
    expect(APP_SHEET_SCRIM_CLASS).toContain(APP_SHEET_SCRIM_FADE_CLASS);

    expect(tokens).toContain(`--app-sheet-duration: ${APP_SHEET_MOTION_DURATION_MS}ms`);
    expect(tokens).toContain(`--app-sheet-easing: ${APP_SHEET_MOTION_EASING}`);
    expect(tokens).not.toMatch(/bounce|spring|elastic/i);

    expect(globals).toContain("@keyframes app-sheet-rise");
    expect(globals).toContain("translateY(100%)");
    expect(globals).toContain("animation: app-sheet-rise var(--app-sheet-duration) var(--app-sheet-easing) both");
    expect(globals).toContain("animation: app-sheet-scrim-fade var(--app-sheet-duration) var(--app-sheet-easing) both");
    expect(globals).not.toMatch(/cubic-bezier\([^)]*1\.[2-9]/);
    expect(globals).not.toMatch(/bounce|animate-bounce|spring/i);

    const sheetReduced = globals.slice(globals.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(sheetReduced).toContain(".app-sheet-rise");
    expect(sheetReduced).toContain("animation: none !important");
    expect(sheetReduced).toContain("transform: none");
    expect(sheetReduced).not.toContain("translateY");
  });

  it("keeps thread ··· glyphs only — surface chrome is MenuSurface", () => {
    expect(THREAD_POPOVER_ICON_CLASS).toContain("size-4");
    expect(THREAD_POPOVER_ICON_CLASS).toContain("text-ink-3");
    expect(THREAD_POPOVER_ICON_CLASS).not.toContain("t-body");
    expect(THREAD_POPOVER_ICON_CLASS).not.toContain("min-w-");
  });
});
