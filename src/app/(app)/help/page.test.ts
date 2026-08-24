import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HELP } from "@/lib/help";
import { HOUSE_EMPTY_CLASS } from "@/lib/house-sheet";
import HelpPage from "./page";

describe("HelpPage", () => {
  it("renders the house empty primitive and does not invent a help product", () => {
    const html = renderToStaticMarkup(createElement(HelpPage));
    expect(html).toContain(HELP.title);
    expect(html).toContain(HELP.empty);
    expect(html).toContain(HOUSE_EMPTY_CLASS);
    expect(html).toContain("data-house-empty");
    expect(html).not.toContain("Contact");
    expect(html).not.toContain("FAQ");
    expect(html).not.toContain("support@");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain("Job");
  });
});
