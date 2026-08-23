import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { TITLES_CATALOG } from "@/lib/titles-catalog";
import { AddTitleButton } from "./add-title-button";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "add-title-button.tsx"), "utf8");
const tokens = readFileSync(join(here, "../../tokens.css"), "utf8");
const globals = readFileSync(join(here, "../../globals.css"), "utf8");

describe("AddTitleButton header", () => {
  it("locks 13px Sporty Blue text on desktop so a mobile-only revert fails", () => {
    const html = renderToStaticMarkup(createElement(AddTitleButton, { orgId: "org-1" }));
    const at = html.indexOf("data-add-title");
    const open = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);

    expect(html).toContain(TITLES_CATALOG.addTitle);
    expect(open).toContain("t-body-sm");
    expect(open).toContain("text-accent");
    expect(open).not.toContain("bg-accent");
    expect(open).not.toContain("max-md:text-accent");
    expect(open).not.toContain("max-md:bg-transparent");
    expect(open).not.toContain("rounded-full");
    expect(src).toContain("t-body-sm font-normal text-accent");
    expect(src).not.toContain("max-md:text-accent");
    expect(src).not.toContain("max-md:bg-transparent");
    expect(src).not.toContain("Plus");
    expect(src).not.toContain("from \"@/components/ui/button\"");
    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(tokens).toContain("--accent: #1769ff;");
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
  });
});
