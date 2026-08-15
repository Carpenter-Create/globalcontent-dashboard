import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GC_ASSETS_EMPTY, GC_ASSETS_HEADING, GcAssets, type GcAsset } from "./gc-assets";

function render(assets: GcAsset[]): string {
  return renderToStaticMarkup(createElement(GcAssets, { assets }));
}

describe("GcAssets", () => {
  it("exports the approved section heading", () => {
    expect(GC_ASSETS_HEADING).toBe("Assets");
  });

  it("empty list shows the approved empty copy and no view action", () => {
    const html = render([]);
    expect(html).toContain(GC_ASSETS_EMPTY);
    expect(html).not.toContain("View / download");
  });

  it("renders each asset's kind, filename, and view action", () => {
    const html = render([
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "master",
        original_filename: "winters-end-master.mov",
        bytes: 2048,
      },
    ]);
    expect(html).toContain("master");
    expect(html).toContain("winters-end-master.mov");
    expect(html).toContain("View / download");
    expect(html).not.toContain(GC_ASSETS_EMPTY);
  });
});
