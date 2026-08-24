import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  APP_SHEET_SURFACE_CLASS,
  CLOSE_44_CLASS,
  TEXT_ACTION_CLASS,
  THREAD_POPOVER_CONTENT_CLASS,
} from "@/lib/house-sheet";
import {
  AppSheetSurface,
  Close44,
  IdentityBlock,
  SheetGroup,
  SheetGroupItem,
  TextAction,
} from "./house";

const here = dirname(fileURLToPath(import.meta.url));
const houseSrc = readFileSync(join(here, "house.tsx"), "utf8");
const accountSrc = readFileSync(join(here, "account-sheet.tsx"), "utf8");
const navSrc = readFileSync(join(here, "mobile-nav.tsx"), "utf8");
const headerSrc = readFileSync(join(here, "messages-app-header.tsx"), "utf8");

describe("house primitives", () => {
  it("exports Close/44, Text action, Identity, Group, and app-sheet chrome", () => {
    const close = renderToStaticMarkup(
      <Close44 label="Close account" onClick={() => undefined} />,
    );
    const action = renderToStaticMarkup(<TextAction href="/account">Manage account</TextAction>);
    const identity = renderToStaticMarkup(
      <IdentityBlock avatarInitial="A" email="ada@example.com" />,
    );
    const group = renderToStaticMarkup(
      <SheetGroup label="ACCOUNT">
        <SheetGroupItem item="agreements" href="/account/agreements">
          Agreements
        </SheetGroupItem>
      </SheetGroup>,
    );
    const sheet = renderToStaticMarkup(<AppSheetSurface>body</AppSheetSurface>);

    expect(close).toContain(CLOSE_44_CLASS);
    expect(close).toContain("stroke-width=\"1.33\"");
    expect(action).toContain(TEXT_ACTION_CLASS);
    expect(action).toContain('href="/account"');
    expect(identity).toContain("data-identity-avatar");
    expect(identity).toContain("ada@example.com");
    expect(identity).not.toContain("data-identity-name");
    expect(identity).not.toContain("—");
    expect(group).toContain("ACCOUNT");
    expect(group).toContain("Agreements");
    expect(sheet).toContain(APP_SHEET_SURFACE_CLASS);
    expect(houseSrc).toContain("543:562");
    expect(houseSrc).toContain("543:563");
    expect(houseSrc).toContain("543:565");
    expect(houseSrc).toContain("543:570");
    expect(houseSrc).toContain("543:576");
    expect(houseSrc).toContain("544:592");
  });

  it("is consumed by the account sheet, nav sheet, and thread popover — not restyled per page", () => {
    expect(accountSrc).toContain("from \"./house\"");
    expect(accountSrc).toContain("<Close44");
    expect(accountSrc).toContain("<AppSheetSurface");
    expect(accountSrc).toContain("<IdentityBlock");
    expect(accountSrc).toContain("<TextAction");
    expect(accountSrc).toContain("<SheetGroup");
    expect(navSrc).toContain("from \"./house\"");
    expect(navSrc).toContain("<Close44");
    expect(navSrc).toContain("<AppSheetSurface");
    expect(navSrc).not.toContain("rounded-t-[24px]");
    expect(headerSrc).toContain("from \"./house\"");
    expect(headerSrc).toContain("<ThreadPopoverContent");
    expect(headerSrc).toContain("<ThreadPopoverItem");
    expect(headerSrc).toContain("THREAD_POPOVER_ICON_CLASS");
    expect(THREAD_POPOVER_CONTENT_CLASS).toContain("rounded-[12px]");
  });
});
