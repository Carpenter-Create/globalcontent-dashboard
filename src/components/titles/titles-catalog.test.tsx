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
  }) => <img src={src} alt="" className={className} />,
}));

import {
  TitlesCatalogFrame,
  TitlesCatalogStill,
} from "./titles-catalog";

const ALL_STATUSES = Object.keys(TITLE_STATUS_LABELS) as TitleStatus[];

describe("TitlesCatalogStill craft", () => {
  it("is a visible surface card, not a floating poster sticker", () => {
    const html = renderToStaticMarkup(
      <TitlesCatalogStill
        href="/titles/1"
        title="Craft film"
        stillUrl="https://cdn/poster.jpg"
        status="live"
        statusLabel={TITLE_STATUS_LABELS.live}
        year="2019"
      />,
    );

    expect(html).toContain("data-titles-catalog-card");
    expect(html).toContain("border-hairline");
    expect(html).toContain("bg-surface");
    expect(html).toContain("rounded-[var(--radius-lg)]");
    expect(html).not.toContain("border-transparent");
    expect(html).not.toContain("bg-gradient");
  });

  it("forces the same 2:3 cover crop on poster and banner stills", () => {
    const poster = renderToStaticMarkup(
      <TitlesCatalogStill
        href="/titles/1"
        title="Poster film"
        stillUrl="https://cdn/poster.jpg"
        status="live"
        statusLabel={TITLE_STATUS_LABELS.live}
      />,
    );
    const banner = renderToStaticMarkup(
      <TitlesCatalogStill
        href="/titles/2"
        title="Banner film"
        stillUrl="https://cdn/banner.jpg"
        status="draft"
        statusLabel={TITLE_STATUS_LABELS.draft}
      />,
    );

    for (const html of [poster, banner]) {
      expect(html).toContain("aspect-[2/3]");
      expect(html).toContain('data-titles-catalog-crop="cover"');
      expect(html).toContain("[&amp;_img]:object-cover");
      expect(html).toContain("[&amp;_img]:object-center");
      expect(html).toContain("object-cover");
      expect(html).not.toContain("object-contain");
      expect(html).not.toContain("aspect-[16/9]");
    }
  });

  it("stacks title, year, and every TITLE_STATUS_LABELS pill — no delivered", () => {
    for (const status of ALL_STATUSES) {
      const html = renderToStaticMarkup(
        <TitlesCatalogStill
          href={`/titles/${status}`}
          title={`${status} film`}
          stillUrl={null}
          status={status}
          statusLabel={TITLE_STATUS_LABELS[status]}
          year={status === "live" ? "2019" : null}
        />,
      );
      expect(html).toContain("data-titles-catalog-stack");
      expect(html).toContain(`${status} film`);
      expect(html).toContain(TITLE_STATUS_LABELS[status]);
      if (status === "live") {
        expect(html).toContain("data-titles-catalog-year");
        expect(html).toContain("2019");
      } else {
        expect(html).not.toContain("data-titles-catalog-year");
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
    const html = renderToStaticMarkup(<TitlesCatalogFrame />);
    expect(html).toContain("gap-[var(--space-6)]");
    expect(html).not.toContain("gap-[var(--space-10)]");
  });
});
