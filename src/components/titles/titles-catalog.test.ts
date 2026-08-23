import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

vi.mock("next/image", () => ({
  default: ({
    src,
    className,
  }: {
    src: string;
    className?: string;
  }) => createElement("img", { src, className, alt: "" }),
}));

import { TITLES_CATALOG } from "@/lib/titles-catalog";

import {
  TitlesCatalogFrame,
  TitlesCatalogHeader,
  TitlesCatalogRail,
  TitlesCatalogRailStill,
  TitlesCatalogStill,
} from "./titles-catalog";

const ALL_STATUSES = Object.keys(TITLE_STATUS_LABELS) as TitleStatus[];

function renderStill(props: {
  href: string;
  title: string;
  stillUrl: string | null;
  status: string;
  statusLabel: string;
  year?: string | null;
}): string {
  return renderToStaticMarkup(createElement(TitlesCatalogStill, props));
}

function openingTagWith(html: string, marker: string): string {
  const at = html.indexOf(marker);
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(">", at);
  return html.slice(start, end + 1);
}

describe("TitlesCatalogStill craft", () => {
  it("lets the still be the canvas — no card chrome, no caption box", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: "https://cdn/poster.jpg",
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
      year: "2019",
    });
    const card = openingTagWith(html, 'data-titles-catalog-card=""');
    const frame = openingTagWith(html, 'data-titles-catalog-frame=""');
    const stack = openingTagWith(html, 'data-titles-catalog-stack=""');

    expect(card).toContain("data-titles-catalog-card");
    expect(card).toContain("flex flex-col gap-[var(--space-3)]");
    expect(card).not.toContain("border-hairline");
    expect(card).not.toContain("bg-surface");
    expect(card).not.toContain("overflow-hidden");
    expect(frame).toContain("rounded-[var(--radius-lg)]");
    expect(stack).not.toContain("px-[var(--space-4)]");
    expect(stack).not.toContain("pb-[var(--space-4)]");
    expect(stack).not.toContain("pt-[var(--space-3)]");
    expect(html).not.toContain("bg-gradient");
    expect(html).not.toContain("shadow");
  });

  it("forces the same 2:3 cover crop on poster and banner stills", () => {
    const poster = renderStill({
      href: "/titles/1",
      title: "Poster film",
      stillUrl: "https://cdn/poster.jpg",
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
    });
    const banner = renderStill({
      href: "/titles/2",
      title: "Banner film",
      stillUrl: "https://cdn/banner.jpg",
      status: "draft",
      statusLabel: TITLE_STATUS_LABELS.draft,
    });

    for (const html of [poster, banner]) {
      const frame = openingTagWith(html, 'data-titles-catalog-frame=""');
      expect(frame).toContain("aspect-[2/3]");
      expect(frame).toContain('data-titles-catalog-crop="cover"');
      expect(frame).toContain("[&amp;_img]:object-cover");
      expect(frame).toContain("[&amp;_img]:object-center");
      expect(html).toContain("object-cover");
      expect(html).not.toContain("object-contain");
      expect(html).not.toContain("aspect-[16/9]");
    }
  });

  it("keeps a null still as honest empty art — no image, no preload", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Empty film",
      stillUrl: null,
      status: "draft",
      statusLabel: TITLE_STATUS_LABELS.draft,
    });

    expect(html).toContain("data-titles-catalog-empty-art");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain("poster.jpg");
    expect(html).not.toContain("t-data select-none text-3xl");
  });

  it("keeps the card title on --text-sm, with year and pill on one line", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: null,
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
      year: "2019",
    });
    const stack = html.slice(html.indexOf("data-titles-catalog-stack"));
    const name = openingTagWith(html, 'data-titles-catalog-name=""');
    const year = openingTagWith(html, 'data-titles-catalog-year=""');
    const meta = openingTagWith(html, 'data-titles-catalog-meta=""');

    expect(name).toContain("t-body-sm font-medium text-ink");
    expect(name).not.toContain("t-heading");
    expect(stack).toContain("Craft film");
    expect(stack).toContain("data-titles-catalog-year");
    expect(year).toContain("t-body-sm font-normal text-ink-3");
    expect(meta).toContain("flex min-w-0 flex-wrap items-center");
    expect(stack).toContain(TITLE_STATUS_LABELS.live);
    expect(stack).not.toContain("t-heading");
    expect(stack).not.toContain("t-section");
    expect(stack).not.toContain("t-display");
    expect(stack).not.toContain("t-title");
    expect(html).toMatch(
      /data-titles-catalog-name[\s\S]*Craft film[\s\S]*data-titles-catalog-meta[\s\S]*data-titles-catalog-year[\s\S]*2019[\s\S]*data-titles-catalog-status[\s\S]*Live/,
    );
  });

  it("marks status as a hairline pill, not a filled muted chip", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: null,
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
    });
    const pill = openingTagWith(html, 'data-titles-catalog-status=""');

    expect(pill).toContain("rounded-full");
    expect(pill).toContain("border-hairline");
    expect(pill).toContain("t-body-sm font-normal text-ink-2");
    expect(pill).not.toContain("bg-surface-muted");
    expect(pill).not.toContain("bg-accent");
    expect(pill).not.toMatch(/green|emerald|success/);
  });

  it("does not scale the poster on hover", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: "https://cdn/poster.jpg",
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
    });
    const card = openingTagWith(html, 'data-titles-catalog-card=""');
    const frame = openingTagWith(html, 'data-titles-catalog-frame=""');

    expect(card).not.toContain("group");
    expect(card).not.toMatch(/hover:scale|group-hover:scale|scale-/);
    expect(frame).not.toMatch(/hover:scale|group-hover:scale|scale-/);
    expect(html).not.toMatch(/hover:scale|group-hover:scale/);
  });

  it("places title, year, and every TITLE_STATUS_LABELS pill — no delivered, no seventh unique", () => {
    for (const status of ALL_STATUSES) {
      const html = renderStill({
        href: `/titles/${status}`,
        title: `${status} film`,
        stillUrl: null,
        status,
        statusLabel: TITLE_STATUS_LABELS[status],
        year: status === "live" ? "2019" : null,
      });
      const stack = html.slice(html.indexOf("data-titles-catalog-stack"));
      expect(stack).toContain(`${status} film`);
      expect(stack).toContain(TITLE_STATUS_LABELS[status]);
      if (status === "live") {
        expect(stack).toContain("data-titles-catalog-year");
        expect(stack).toContain("2019");
      } else {
        expect(stack).not.toContain("data-titles-catalog-year");
      }
    }
    const labels = ALL_STATUSES.map((status) => TITLE_STATUS_LABELS[status]);
    expect(labels).toHaveLength(7);
    expect(new Set(labels).size).toBe(6);
    expect(TITLE_STATUS_LABELS.in_delivery).toBe("Submitted");
    expect(TITLE_STATUS_LABELS.submitted).toBe("Submitted");
    expect(labels).not.toContain("Delivered");
    expect(labels).not.toContain("delivered");
  });
});

describe("TitlesCatalogFrame craft", () => {
  it("uses a house --space-* gap under the operate bar, not the old canyon", () => {
    const html = renderToStaticMarkup(createElement(TitlesCatalogFrame));
    expect(html).toContain("md:gap-[var(--space-8)]");
    expect(html).toContain("gap-[var(--space-12)]");
    expect(html).not.toContain("gap-[var(--space-10)]");
    expect(html).not.toContain("gap-[var(--space-6)]");
  });

  it("tightens empty 529:542 to 24 between identity and copy", () => {
    const html = renderToStaticMarkup(createElement(TitlesCatalogFrame, { empty: true }));
    expect(html).toContain("gap-[var(--space-6)] md:gap-[var(--space-8)]");
    expect(html).not.toContain("gap-[var(--space-12)] md:gap-[var(--space-8)]");
  });
});

describe("TitlesCatalogHeader type lock", () => {
  it("keeps the page title on the 24px section step, not a second hero", () => {
    const html = renderToStaticMarkup(createElement(TitlesCatalogHeader));

    expect(html).toMatch(/<h1 class="t-section text-ink max-md:hidden">Titles<\/h1>/);
    expect(html).toContain(TITLES_CATALOG.title);
    expect(html).not.toMatch(/<h1[^>]*t-display/);
    expect(html).not.toMatch(/<h1[^>]*t-title/);
    expect(html).not.toContain("t-heading");
  });

  it("puts count under the title and search on the same header row", () => {
    const html = renderToStaticMarkup(
      createElement(TitlesCatalogHeader, {
        count: "7 in catalog",
        action: createElement("span", null, "Search"),
      }),
    );

    expect(html).toContain(
      "titles-catalog-header flex items-center justify-between gap-[var(--space-2)] md:items-start md:gap-[var(--space-6)]",
    );
    expect(html).toContain("data-titles-catalog-count");
    expect(html).toContain("7 in catalog");
    expect(html).not.toContain("10 in catalog");
    expect(html).toContain("data-titles-catalog-operate");
    expect(html).toContain(
      "titles-catalog-operate flex shrink-0 items-center gap-[var(--space-4)]",
    );
    expect(html).not.toContain("titles-catalog-operate flex w-full items-center justify-between");
    const titleAt = html.indexOf("<h1");
    const countAt = html.indexOf("data-titles-catalog-count");
    const operateAt = html.indexOf("data-titles-catalog-operate");
    expect(titleAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(titleAt);
    expect(operateAt).toBeGreaterThan(countAt);
  });

  it("locks the page title to --text-title and the card title to --text-sm", () => {
    const tokens = readFileSync(join(ROOT, "src/app/tokens.css"), "utf8");
    const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(tokens).toMatch(/--text-title:\s*1\.5rem;/);
    expect(globals).toMatch(/\.t-section\s*\{[\s\S]*?font-size:\s*var\(--text-title\)/);
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
  });

  it("uses the org name on mobile 528:542 and Titles on desktop 1:3", () => {
    const html = renderToStaticMarkup(
      createElement(TitlesCatalogHeader, { identity: "Acme" }),
    );
    expect(html).toContain("data-titles-catalog-identity");
    expect(html).toContain("Acme");
    expect(html).toContain("md:hidden");
    expect(html).toMatch(/<h1 class="t-section text-ink max-md:hidden">Titles<\/h1>/);
    expect(html).not.toContain("Meridian Pictures");
  });
});

describe("TitlesCatalogRail 528:542 lock", () => {
  it("is one Recent snap rail — 140×210 r12, 16 gap, 16 side", () => {
    const html = renderToStaticMarkup(
      createElement(
        TitlesCatalogRail,
        null,
        createElement(TitlesCatalogRailStill, {
          href: "/titles/1",
          title: "Craft film",
          stillUrl: null,
          status: "live",
          year: "2019",
        }),
      ),
    );
    const rail = openingTagWith(html, 'data-titles-catalog-rail=""');
    const track = openingTagWith(html, 'data-titles-catalog-rail-track=""');
    const card = openingTagWith(html, 'data-titles-catalog-rail-card=""');
    const frame = openingTagWith(html, 'data-titles-catalog-rail-frame=""');
    const name = openingTagWith(html, 'data-titles-catalog-rail-name=""');
    const year = openingTagWith(html, 'data-titles-catalog-rail-year=""');

    expect(html).toContain(TITLES_CATALOG.recent);
    expect(html).not.toContain("Recently added");
    expect(html).not.toContain("Store");
    expect(html).not.toContain("Spotlight");
    expect(rail).toContain("md:hidden");
    expect(track).toContain("snap-x");
    expect(track).toContain("snap-mandatory");
    expect(track).toContain("gap-[var(--space-4)]");
    expect(track).toContain("px-[var(--space-4)]");
    expect(card).toContain("w-[140px]");
    expect(card).toContain("snap-start");
    expect(frame).toContain("h-[210px]");
    expect(frame).toContain("w-[140px]");
    expect(frame).toContain("rounded-[12px]");
    expect(frame).not.toContain("rounded-[var(--radius-lg)]");
    expect(name).toContain("t-body text-ink");
    expect(year).toContain("t-body-sm font-normal text-ink-2");
    expect(html).toContain("2019");
    expect(html).not.toContain("data-titles-catalog-status");
    expect(html).not.toContain("bg-band");
    expect(html).not.toMatch(/\bStore\b/);
    expect(html.match(/data-titles-catalog-rail=""/g) ?? []).toHaveLength(1);
  });
});
