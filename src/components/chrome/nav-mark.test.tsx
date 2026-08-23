import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { ASK_GLOBEE_NAV_MARK, NAV, isNavImageItem } from "@/lib/nav";
import { NavMark } from "./nav-mark";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nav-mark.tsx"), "utf8");
const navSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../lib/nav.ts"), "utf8");

describe("NavMark", () => {
  it("renders Ask Globee as the cropped 16 bee in the size-4 slot, with 64 as 2x", () => {
    const dest = NAV.find((item) => item.href === "/messages");
    expect(dest?.label).toBe(ASK_GLOBEE.headline);
    expect(isNavImageItem(dest!)).toBe(true);
    const html = renderToStaticMarkup(<NavMark item={dest!} />);

    expect(html).toContain("data-ask-globee-nav-mark");
    expect(html).toContain('src="/ask-globee/ask-globee-16.png"');
    expect(html).toContain('srcSet="/ask-globee/ask-globee-64.png 2x"');
    expect(html).toContain("size-4 shrink-0");
    expect(html).not.toContain("overflow-hidden");
    expect(html).not.toContain("size-6");
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).not.toContain("lucide-");
    expect(html).not.toContain("stroke-width");
    expect(src).not.toContain("MessageSquare");
    expect(src).not.toContain("Sparkle");
    expect(src).not.toContain("Shield");
    expect(src).not.toContain("<svg");
    expect(navSrc).not.toContain("MessageSquare");
    expect(navSrc).toContain("K0vd70n4Xvftm0aSpuWu77");
    expect(navSrc).toContain("18:3");
    expect(navSrc).toContain("18:2");
    expect(ASK_GLOBEE_NAV_MARK.displaySrc).toBe(ASK_GLOBEE_NAV_MARK.src16);
    const landing = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../messages/ask-globee-landing.tsx"),
      "utf8",
    );
    expect(landing).toContain("Figma 7:73 landing chrome");
    expect(landing).not.toContain("ask-globee-16.png");
    expect(landing).not.toContain("ask-globee-64.png");
    expect(landing).not.toContain("NavMark");
  });

  it("keeps other rail destinations on Lucide 16 / 1.33", () => {
    for (const item of NAV) {
      if (item.href === "/messages") continue;
      const html = renderToStaticMarkup(<NavMark item={item} />);
      expect(isNavImageItem(item)).toBe(false);
      expect(html).toContain("lucide-");
      expect(html).toContain("size-4");
      expect(html).toContain("shrink-0");
      expect(html).toContain('stroke-width="1.33"');
      expect(html).not.toContain("data-ask-globee-nav-mark");
      expect(html).not.toContain("ask-globee");
    }
    expect(src).toContain('<Icon className="size-4 shrink-0" strokeWidth={1.33} />');
  });
});
