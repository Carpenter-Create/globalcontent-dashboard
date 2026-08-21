import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  appendAskGlobeeTurn: vi.fn(),
  completeAskGlobeeTurn: vi.fn(),
  setAskGlobeeThumb: vi.fn(),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import { AskGlobeeThread } from "./ask-globee-thread";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-thread.tsx"), "utf8");
const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";
const USER_MSG = "3a2d9c7b-5e4f-4b22-8d33-8c9f2e1b6a55";
const GLOBEE_MSG = "4b3e0d8c-6f50-4c33-9e44-9d0a3f2c7b66";

const CONVERSATION = {
  id: THREAD,
  title: "What needs attention",
  pinned_at: null,
  created_at: "2026-08-19T11:00:00.000Z",
  updated_at: "2026-08-19T11:10:00.000Z",
};

function renderThread(
  messages: {
    id: string;
    role: "user" | "globee";
    body: string;
    lead: string | null;
    follow: string | null;
    thumbs: "up" | "down" | null;
    created_at: string;
  }[] = [
    {
      id: USER_MSG,
      role: "user",
      body: "What needs attention",
      lead: null,
      follow: null,
      thumbs: null,
      created_at: "2026-08-19T11:00:00.000Z",
    },
    {
      id: GLOBEE_MSG,
      role: "globee",
      body: "Harbor Cut — Synopsis is required.",
      lead: "Harbor Cut — Synopsis is required.",
      follow: null,
      thumbs: null,
      created_at: "2026-08-19T11:10:00.000Z",
    },
  ],
) {
  return visible(
    renderToStaticMarkup(
      <AskGlobeeThread initials="A" conversation={CONVERSATION} messages={messages} />,
    ),
  );
}

describe("AskGlobeeThread", () => {
  it("locks 247:295 chrome around persisted turns, not the Winter Line fixture", () => {
    const html = renderThread();

    expect(html).toContain('data-ask-globee-thread=""');
    expect(html).toContain("What needs attention");
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain(ASK_GLOBEE.globeeMark);
    expect(html).toContain(ASK_GLOBEE.attributionName);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).toContain(ASK_GLOBEE.copyLabel);
    expect(html).toContain(ASK_GLOBEE.downloadLabel);
    expect(html).toContain(ASK_GLOBEE.thumbsUpLabel);
    expect(html).toContain(ASK_GLOBEE.thumbsDownLabel);
    expect(html).toContain(">A<");
    expect(html).toContain("max-w-[640px]");
    expect(html).toContain("px-[var(--content-inset)]");
    expect(html).toContain("bg-surface-muted");
    expect(html).toContain("bg-accent");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.answerFollow);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(src).toContain("navigator.clipboard.writeText");
    expect(src).toContain("askGlobeeDownloadFilename");
    expect(src).toContain("setAskGlobeeThumb");
    expect(src).toContain("appendAskGlobeeTurn");
    expect(src).toContain("completeAskGlobeeTurn");
    expect(src).toContain("askGlobeeOpenUserTurn");
    expect(src).toContain("router.refresh()");
    expect(src).toContain("askGlobeeUsesModel(next)");
    expect(src).toContain("AskGlobeeThinking");
    expect(src).toContain("stopThinking");
    expect(html).not.toContain("data-ask-globee-thinking");
    expect(src).not.toContain("router.replace");
    expect(src).not.toContain("askGlobeeThreadHref");
    expect(src).not.toContain("ANTHROPIC");
    expect(src).not.toContain("ask-globee-operator");
  });

  it("swaps the copy control to a brief check and does not toast", () => {
    const html = renderThread();

    expect(html).toContain(`aria-label="${ASK_GLOBEE.copyLabel}"`);
    expect(html).not.toContain("data-ask-globee-copied");
    expect(src).toContain("navigator.clipboard.writeText");
    expect(src).toContain("setCopiedId");
    expect(src).toContain("copiedId === message.id");
    expect(src).toContain("<Check");
    expect(src).toContain("data-ask-globee-copied");
    expect(src).not.toContain("toast");
    expect(src).not.toMatch(/bounce|animate-bounce/i);
    expect(src).toContain("askGlobeeDownloadFilename");
    expect(src).toContain("setAskGlobeeThumb");
  });

  it("stacks turns on house 24 with a hairline between them", () => {
    const html = renderThread([
      {
        id: USER_MSG,
        role: "user",
        body: "What needs attention",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:00:00.000Z",
      },
      {
        id: GLOBEE_MSG,
        role: "globee",
        body: "Harbor Cut — Synopsis is required.",
        lead: "Harbor Cut — Synopsis is required.",
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:10:00.000Z",
      },
      {
        id: "5c4f1e9d-7061-4d44-af55-ae1b4a3d8c77",
        role: "user",
        body: "What is blocking a title",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:20:00.000Z",
      },
      {
        id: "6d5a2f0e-8172-4e55-b066-bf2c5b4e9d88",
        role: "globee",
        body: CATALOG_HEALTH_EMPTY,
        lead: CATALOG_HEALTH_EMPTY,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:21:00.000Z",
      },
    ]);
    expect(html).toContain("What needs attention");
    expect(html).toContain("What is blocking a title");
    expect(html).toContain(CATALOG_HEALTH_EMPTY);
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain('data-ask-globee-turn=""');
    expect(html).toContain("gap-[var(--space-6)]");
    expect(html).toContain("border-t border-hairline");
    expect(html).toContain("pt-[var(--space-6)]");
    expect(html).not.toContain("gap-[var(--space-16)]");
    expect(html).not.toContain("pt-[var(--space-3)]");
    expect(html.match(/data-ask-globee-turn=""/g)?.length).toBe(2);
    expect(html.match(/border-t border-hairline/g)?.length).toBe(1);
    expect(html.match(/pt-\[var\(--space-6\)\]/g)?.length).toBe(1);
    expect(src).toContain(
      "flex flex-col gap-[var(--space-6)] border-t border-hairline pt-[var(--space-6)]",
    );
    expect(src).toContain('className="flex flex-1 flex-col gap-[var(--space-6)] px-[var(--content-inset)]"');
    expect(src).not.toMatch(/border-t border-hairline"/);
  });

  it("keeps a follow-up on the same thread instead of opening a new one", () => {
    const html = renderThread([
      {
        id: USER_MSG,
        role: "user",
        body: "What needs attention",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:00:00.000Z",
      },
      {
        id: GLOBEE_MSG,
        role: "globee",
        body: "Harbor Cut — Synopsis is required.",
        lead: "Harbor Cut — Synopsis is required.",
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:10:00.000Z",
      },
      {
        id: "5c4f1e9d-7061-4d44-af55-ae1b4a3d8c77",
        role: "user",
        body: "What is blocking a title",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:20:00.000Z",
      },
      {
        id: "6d5a2f0e-8172-4e55-b066-bf2c5b4e9d88",
        role: "globee",
        body: CATALOG_HEALTH_EMPTY,
        lead: CATALOG_HEALTH_EMPTY,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:21:00.000Z",
      },
    ]);
    expect(html).toContain("What needs attention");
    expect(html).toContain("What is blocking a title");
    expect(html).toContain(CATALOG_HEALTH_EMPTY);
    expect(html).toContain("Harbor Cut — Synopsis is required.");
  });

  it("scrolls the latest turn into view when the thread grows", () => {
    const html = renderThread();

    expect(html).toContain('data-ask-globee-thread-end=""');
    expect(src).toContain("latestTurnRef");
    expect(src).toContain("scrollIntoView");
    expect(src).toContain("useRef");
  });

  it("kills the composer inner focus ring without restyling the pill hairline", () => {
    const html = renderThread();
    const composer = html.slice(html.indexOf("data-ask-globee-composer"));

    expect(composer).toContain("border-hairline");
    expect(composer).toContain("outline-none");
    expect(composer).toContain("ring-0");
    expect(composer).toContain("focus-visible:outline-none");
    expect(composer).toContain("focus-visible:ring-0");
    expect(src).toContain("focus:outline-none");
    expect(src).toContain("focus:ring-0");
    expect(src).not.toContain("focus:border-accent");
    expect(src).not.toContain("focus:ring-accent");
  });

  it("can render the honest empty-catalog line", () => {
    const html = renderThread([
      {
        id: USER_MSG,
        role: "user",
        body: "What needs attention",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:00:00.000Z",
      },
      {
        id: GLOBEE_MSG,
        role: "globee",
        body: CATALOG_HEALTH_EMPTY,
        lead: CATALOG_HEALTH_EMPTY,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:10:00.000Z",
      },
    ]);
    expect(html).toContain(CATALOG_HEALTH_EMPTY);
    expect(html).not.toContain("Artwork missing");
  });

  it("does not restore header Search or the Access upgrade card", () => {
    const html = renderThread();

    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.analyze);
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-upgrade");
  });

  it("shows thinking chrome while a landing-originated turn is in flight", () => {
    const html = renderThread([
      {
        id: USER_MSG,
        role: "user",
        body: "What is blocking a title",
        lead: null,
        follow: null,
        thumbs: null,
        created_at: "2026-08-19T11:00:00.000Z",
      },
    ]);

    expect(html).toContain("What is blocking a title");
    expect(html).toContain('data-ask-globee-thinking=""');
    expect(html).toContain(ASK_GLOBEE.thinking);
    expect(html).toContain(ASK_GLOBEE.stop);
    expect(html).toContain(ASK_GLOBEE.stopHint);
    expect(html).toContain('data-ask-globee-user-row=""');
    expect(html).not.toContain("Looking at");
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain(ASK_GLOBEE.emptyBlocking);
    expect(html).not.toContain(ASK_GLOBEE.capability);
    expect(src).toContain("completeAskGlobeeTurn");
    expect(src).toContain("askGlobeeOpenUserTurn");
  });

  it("keeps Access isolation: the upgrade gate never renders this thread", () => {
    const html = renderThread();

    expect(html).toContain('data-ask-globee-thread=""');
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-upgrade");
    expect(html).not.toContain(ASK_GLOBEE.analyze);
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(src).toContain("data-ask-globee-thread");
    expect(src).not.toContain("AccessUpgradeGate");
    expect(src).not.toContain("canRenderAskGlobeeThread");
  });
});
