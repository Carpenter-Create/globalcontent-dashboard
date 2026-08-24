import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HOUSE_EMPTY_CLASS } from "@/lib/house-sheet";
import { REFER } from "@/lib/refer";
import ReferPage from "./page";

describe("ReferPage", () => {
  it("renders the house empty primitive and does not invent a referral product", () => {
    const html = renderToStaticMarkup(createElement(ReferPage));
    expect(html).toContain(REFER.title);
    expect(html).toContain(REFER.empty);
    expect(html).toContain(HOUSE_EMPTY_CLASS);
    expect(html).toContain("data-house-empty");
    expect(html).not.toContain("reward");
    expect(html).not.toContain("Share a link");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain("Job");
  });
});
