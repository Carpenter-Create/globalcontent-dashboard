import { describe, expect, it } from "vitest";

import {
  APP_SHEET_HAIRLINE_CLASS,
  APP_SHEET_HEAD_CLASS,
  APP_SHEET_SCRIM_CLASS,
  APP_SHEET_SURFACE_CLASS,
  CLOSE_44_CLASS,
  IDENTITY_AVATAR_CLASS,
  IDENTITY_BLOCK_CLASS,
  SHEET_GROUP_CLASS,
  SHEET_GROUP_ITEM_CLASS,
  SHEET_GROUP_LABEL_CLASS,
  TEXT_ACTION_CLASS,
  THREAD_POPOVER_CONTENT_CLASS,
  THREAD_POPOVER_DELETE_CLASS,
  THREAD_POPOVER_ICON_CLASS,
  THREAD_POPOVER_ITEM_CLASS,
} from "./house-sheet";

describe("house sheet lock", () => {
  it("keeps Close/44 on the muted 44 circle", () => {
    expect(CLOSE_44_CLASS).toContain("size-[44px]");
    expect(CLOSE_44_CLASS).toContain("min-h-[44px]");
    expect(CLOSE_44_CLASS).toContain("min-w-[44px]");
    expect(CLOSE_44_CLASS).toContain("rounded-full");
    expect(CLOSE_44_CLASS).toContain("bg-surface-muted");
    expect(CLOSE_44_CLASS).toContain("text-ink-3");
  });

  it("keeps Text action on 13 Sporty Blue", () => {
    expect(TEXT_ACTION_CLASS).toContain("t-body-sm");
    expect(TEXT_ACTION_CLASS).toContain("text-accent");
    expect(TEXT_ACTION_CLASS).not.toContain("bg-accent");
  });

  it("keeps Identity on a 48 circle with no pill well", () => {
    expect(IDENTITY_AVATAR_CLASS).toContain("size-12");
    expect(IDENTITY_AVATAR_CLASS).toContain("rounded-full");
    expect(IDENTITY_AVATAR_CLASS).toContain("bg-surface-muted");
    expect(IDENTITY_BLOCK_CLASS).not.toContain("bg-surface-muted");
    expect(IDENTITY_BLOCK_CLASS).not.toContain("rounded-[");
  });

  it("keeps Group on 12 tracked ACCOUNT rows and 15 Regular items", () => {
    expect(SHEET_GROUP_CLASS).toContain("gap-[var(--space-6)]");
    expect(SHEET_GROUP_LABEL_CLASS).toContain("uppercase");
    expect(SHEET_GROUP_LABEL_CLASS).toContain("tracking-[0.08em]");
    expect(SHEET_GROUP_ITEM_CLASS).toContain("text-[length:var(--text-base)]");
    expect(SHEET_GROUP_ITEM_CLASS).toContain("text-ink");
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
    expect(APP_SHEET_SCRIM_CLASS).toBe("absolute inset-0 bg-ink/24");
  });

  it("locks Thread Popover to 15 Regular ink, pad 16, gap 8, r12, quiet hairline", () => {
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("rounded-[12px]");
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("p-[var(--space-4)]");
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("gap-[var(--space-2)]");
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("border-hairline");
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("shadow-none");
    expect(THREAD_POPOVER_ITEM_CLASS).toContain("t-body");
    expect(THREAD_POPOVER_ITEM_CLASS).toContain("text-ink");
    expect(THREAD_POPOVER_DELETE_CLASS).toContain("text-[#c4564a]");
    expect(THREAD_POPOVER_ICON_CLASS).toContain("size-4");
    expect(THREAD_POPOVER_ICON_CLASS).toContain("text-ink-3");
  });
});
