import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import {
  ASK_GLOBEE_DOWNLOAD,
  ASK_GLOBEE_DOWNLOAD_CONTENT_TYPE,
  askGlobeeDownloadBlob,
  askGlobeeDownloadFilename,
  buildAskGlobeeDownloadPdf,
  parseAskGlobeeDownloadInk,
  stackAskGlobeeDownloadFacts,
} from "./ask-globee-download";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-download.ts"), "utf8");

function pdfString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function pdfVisibleText(bytes: Uint8Array): string {
  return [...pdfString(bytes).matchAll(/\((?:\\[()\\]|[^\\)])*\) Tj/g)]
    .map((match) => match[0].slice(1, -4).replace(/\\([()\\])/g, "$1"))
    .join("");
}

describe("askGlobeeDownloadFilename", () => {
  it("names the file globee-{slug}.pdf from the live title, not .txt", () => {
    expect(askGlobeeDownloadFilename("What needs attention")).toBe("globee-what-needs-attention.pdf");
    expect(askGlobeeDownloadFilename("What needs attention")).not.toMatch(/\.txt$/);
    expect(askGlobeeDownloadFilename("   ")).toBe("globee-conversation.pdf");
  });

  it("slugs the Winter Line fixture title as a filename example only", () => {
    expect(askGlobeeDownloadFilename(ASK_GLOBEE.threadTitle)).toBe(
      "globee-whats-blocking-the-winter-line.pdf",
    );
    expect(askGlobeeDownloadFilename("Harbor Cut needs a synopsis")).toBe(
      "globee-harbor-cut-needs-a-synopsis.pdf",
    );
    expect(src).not.toContain("Winter Line");
    expect(src).not.toContain("whats-blocking-the-winter-line");
  });
});

describe("askGlobee download ink", () => {
  it("stacks live lead/follow and drops bullets and raw **", () => {
    expect(
      stackAskGlobeeDownloadFacts("Harbor Cut is missing **Genre**.", "- Genre is required before it can go live."),
    ).toEqual(["Harbor Cut is missing **Genre**.", "Genre is required before it can go live."]);

    const spans = parseAskGlobeeDownloadInk("Harbor Cut is missing **Genre**.");
    expect(spans).toEqual([
      { text: "Harbor Cut is missing ", medium: false },
      { text: "Genre", medium: true },
      { text: ".", medium: false },
    ]);
    expect(spans.map((span) => span.text).join("")).not.toContain("**");
    expect(parseAskGlobeeDownloadInk("Synopsis is required.")).toEqual([
      { text: "Synopsis", medium: true },
      { text: " is required.", medium: false },
    ]);
  });
});

describe("buildAskGlobeeDownloadPdf", () => {
  it("writes a Global Content letter PDF from the live turn, never Mercury", () => {
    const bytes = buildAskGlobeeDownloadPdf({
      title: "What needs attention",
      userPrompt: "What needs attention",
      initials: "ac",
      lead: "Harbor Cut is missing **Genre**.",
      follow: "Genre is required before it can go live.",
    });
    const raw = pdfString(bytes);
    const text = pdfVisibleText(bytes);

    expect(ASK_GLOBEE_DOWNLOAD_CONTENT_TYPE).toBe("application/pdf");
    expect(ASK_GLOBEE_DOWNLOAD.contentType).toBe("application/pdf");
    expect(askGlobeeDownloadBlob({
      title: "What needs attention",
      userPrompt: "What needs attention",
      initials: "ac",
      lead: "Harbor Cut is missing **Genre**.",
      follow: "Genre is required before it can go live.",
    }).type).toBe("application/pdf");
    expect(bytes[0]).toBe(0x25);
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toContain(`/MediaBox [0 0 ${ASK_GLOBEE_DOWNLOAD.pageWidth} ${ASK_GLOBEE_DOWNLOAD.pageHeight}]`);
    expect(text).toContain("Global Content");
    expect(text).toContain("Globee AI");
    expect(text).toContain("What needs attention");
    expect(text).toContain("Harbor Cut is missing Genre.");
    expect(text).toContain("Genre is required before it can go live.");
    expect(text).toContain("AC");
    expect(text).not.toContain("**");
    expect(raw).not.toContain("**");
    expect(text).not.toContain("Mercury");
    expect(text).not.toContain("Mercury AI");
    expect(text).not.toContain("Beta");
    expect(raw).not.toContain("Mercury");
    expect(raw).not.toContain("Mercury AI");
    expect(raw).not.toContain("Beta");
    expect(text).not.toContain("Winter Line");
    expect(text).not.toContain("- Genre is required");
    expect(src).not.toMatch(/Mercury AI|Mercury|Beta/);
  });

  it("uses the fixture title and lead only when they are the live turn", () => {
    const bytes = buildAskGlobeeDownloadPdf({
      title: ASK_GLOBEE.threadTitle,
      userPrompt: ASK_GLOBEE.userPrompt,
      initials: "AC",
      lead: ASK_GLOBEE.answerLead,
      follow: ASK_GLOBEE.answerFollow,
    });
    const text = pdfVisibleText(bytes);
    expect(text).toContain(ASK_GLOBEE.threadTitle);
    expect(text).toContain("Genre");
    expect(text).toContain("Synopsis");
    expect(text).toContain("Runtime");
    expect(text).toContain("Director");
    expect(text).toContain("Globee AI");
    expect(text).not.toContain("**");
    expect(text).not.toContain("Mercury");
  });
});
