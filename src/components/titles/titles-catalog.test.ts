import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";

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
  it("is a visible surface card, not a floating poster sticker", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: "https://cdn/poster.jpg",
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
      year: "2019",
    });
    const card = openingTagWith(html, 'data-titles-catalog-card=""');

    expect(card).toContain("data-titles-catalog-card");
    expect(card).toContain("border-hairline");
    expect(card).toContain("bg-surface");
    expect(card).toContain("rounded-[var(--radius-lg)]");
    expect(card).not.toContain("border-transparent");
    expect(html).not.toContain("bg-gradient");
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

  it("keeps the card title on the body-strong step, not display", () => {
    const html = renderStill({
      href: "/titles/1",
      title: "Craft film",
      stillUrl: null,
      status: "live",
      statusLabel: TITLE_STATUS_LABELS.live,
      year: "2019",
    });
    const stack = html.slice(html.indexOf("data-titles-catalog-stack"));

    expect(stack).toContain("t-body font-medium text-ink");
    expect(stack).toContain("Craft film");
    expect(stack).toContain("data-titles-catalog-year");
    expect(stack).toContain(TITLE_STATUS_LABELS.live);
    expect(stack).not.toContain("t-section");
    expect(stack).not.toContain("t-display");
    expect(stack).not.toContain("t-title");
    expect(stack).not.toContain("t-heading");
  });

  it("stacks title, year, and every TITLE_STATUS_LABELS pill — no delivered", () => {
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
    expect(labels).not.toContain("Delivered");
    expect(labels).not.toContain("delivered");
  });
});

describe("TitlesCatalogFrame craft", () => {
  it("uses a house --space-* gap under the operate bar, not the old canyon", () => {
    const html = renderToStaticMarkup(createElement(TitlesCatalogFrame));
    expect(html).toContain("gap-[var(--space-6)]");
    expect(html).not.toContain("gap-[var(--space-10)]");
  });
});

describe("TitlesCatalogHeader type lock", () => {
  it("keeps the page title on the section step, not a second hero", () => {
    const html = renderToStaticMarkup(createElement(TitlesCatalogHeader));

    expect(html).toMatch(/<h1 class="t-section text-ink">Titles<\/h1>/);
    expect(html).toContain(TITLES_CATALOG.title);
    expect(html).not.toMatch(/<h1[^>]*t-display/);
    expect(html).not.toMatch(/<h1[^>]*t-title/);
    expect(html).not.toContain("t-heading");
  });
});
