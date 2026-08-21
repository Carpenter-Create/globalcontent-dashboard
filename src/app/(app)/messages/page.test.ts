import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgTier } from "@/lib/org-tier";
import { ASK_GLOBEE } from "@/lib/ask-globee";
import { MESSAGES_EMPTY } from "@/lib/notifications";
import MessagesPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-tier", () => ({ getActiveOrgTier: vi.fn() }));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  startAskGlobeeConversation: vi.fn(),
  appendAskGlobeeTurn: vi.fn(),
  completeAskGlobeeTurn: vi.fn(),
  setAskGlobeeThumb: vi.fn(),
  renameAskGlobeeConversation: vi.fn(),
  pinAskGlobeeConversation: vi.fn(),
  deleteAskGlobeeConversation: vi.fn(),
}));

const pageSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

const LEAK_TITLE = "ACCESS_MUST_NOT_SEE_TITLE";
const LEAK_FINDING = "ACCESS_MUST_NOT_SEE_SYNOPSIS";
const OTHER_ORG_FINDING = "SECRET_OTHER_ORG";
const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";
const USER_MSG = "3a2d9c7b-5e4f-4b22-8d33-8c9f2e1b6a55";
const GLOBEE_MSG = "4b3e0d8c-6f50-4c33-9e44-9d0a3f2c7b66";

function ctx({
  isGcStaff = false,
  hasOrg = true,
  email = "ada@example.com",
}: {
  isGcStaff?: boolean;
  hasOrg?: boolean;
  email?: string;
} = {}) {
  const org = hasOrg ? { id: "org-1", name: "Meridian Pictures", status: "active" } : null;
  return {
    user: { id: "u1", email },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: !!org,
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

function stubClient({
  notifications = [],
  conversations = [],
  messages = [],
}: {
  notifications?: unknown[];
  conversations?: {
    id: string;
    title: string;
    pinned_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
  messages?: {
    id: string;
    role: "user" | "globee";
    body: string;
    lead: string | null;
    follow: string | null;
    thumbs: "up" | "down" | null;
    created_at: string;
  }[];
} = {}) {
  const eq = vi.fn();
  const conversationsChain = {
    select: vi.fn(() => conversationsChain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return conversationsChain;
    },
    range: vi.fn(async () => ({ data: conversations, error: null })),
    maybeSingle: vi.fn(async () => ({ data: conversations[0] ?? null, error: null })),
  };
  const messagesChain = {
    select: vi.fn(() => messagesChain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return messagesChain;
    },
    order: vi.fn(() => messagesChain),
    range: vi.fn(async () => ({ data: messages, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "conversations") return conversationsChain;
    if (table === "conversation_messages") return messagesChain;
    throw new Error(`unexpected from(${table})`);
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_notifications") return { data: notifications, error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, eq, rpc };
}

async function renderPage(
  search: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  return renderToStaticMarkup(
    await MessagesPage({ searchParams: Promise.resolve(search) }),
  ).replaceAll("&#x27;", "'");
}

function expectNoThreadFixture(html: string) {
  expect(html).not.toContain("data-ask-globee-thread");
  expect(html).not.toContain(ASK_GLOBEE.userPrompt);
  expect(html).not.toContain(ASK_GLOBEE.answerLead);
  expect(html).not.toContain(ASK_GLOBEE.answerFollow);
  expect(html).not.toContain(ASK_GLOBEE.attribution);
  expect(html).not.toContain("Winter Line");
  expect(html).not.toContain("Harbor Lights");
  expect(html).not.toContain("Get support");
}

function expectNoLanding(html: string) {
  expect(html).not.toContain("data-ask-globee-landing");
  expect(html).not.toContain("data-ask-globee-composer");
  expect(html).not.toContain("data-ask-globee-chip");
  expect(html).not.toContain("data-ask-globee-try");
  expect(html).not.toContain("data-ask-globee-history");
  expect(html).not.toContain(ASK_GLOBEE.need);
  expect(html).not.toContain(ASK_GLOBEE.tryLabel);
  expect(html).not.toContain(ASK_GLOBEE.composerPlaceholder);
  for (const label of ASK_GLOBEE.tryPrompts) {
    expect(html).not.toContain(label);
  }
}

function expectNoCatalogLeak(html: string) {
  expect(html).not.toContain(LEAK_TITLE);
  expect(html).not.toContain(LEAK_FINDING);
  expect(html).not.toContain(OTHER_ORG_FINDING);
  expect(html).not.toContain("ORPHAN_FINDING");
  expect(html).not.toContain("Harbor Cut");
  expect(html).not.toContain("Synopsis is required.");
}

describe("MessagesPage surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubClient();
  });

  it("does not render the thread on the landing index", async () => {
    expect(pageSrc).toContain("AskGlobeeLanding");
    expect(pageSrc).toContain("AskGlobeeThread");
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-thinking");
    expect(html).not.toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).not.toContain(ASK_GLOBEE.findingSignal);
    expect(html).not.toContain(ASK_GLOBEE.escToCancel);
    expectNoThreadFixture(html);
  });

  it("shows the Access upgrade gate and never the landing, thread, history, or findings", async () => {
    stubClient({
      conversations: [
        {
          id: THREAD,
          title: LEAK_TITLE,
          pinned_at: null,
          created_at: "2026-08-15T00:00:00.000Z",
          updated_at: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("access");

    const html = await renderPage({ thread: THREAD, q: "What needs attention" });

    expect(html).toContain("data-ask-globee-gate");
    expect(html).toContain('class="t-display text-center text-ink"');
    expect(html).toContain(ASK_GLOBEE.headline);
    expect(html).toContain(ASK_GLOBEE.analyze);
    expect(html).toContain(ASK_GLOBEE.included);
    expect(html).toContain(ASK_GLOBEE.upgrade);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("data-messages-inbox");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expectNoCatalogLeak(html);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("defaults a missing readable tier to the Access gate", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue(null);

    const html = await renderPage({ thread: THREAD });
    expect(html).toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expectNoCatalogLeak(html);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("shows the 7:73 landing for Pro and never the Access gate or fixture thread", async () => {
    const { rpc, from } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ email: "ada@example.com" }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-landing");
    expect(html).toContain("t-display");
    expect(html).toContain(ASK_GLOBEE.headline);
    expect(html).toContain(ASK_GLOBEE.need);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).toContain(ASK_GLOBEE.tryLabel);
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).toContain(label);
    }
    expect(html).toContain("data-ask-globee-clock");
    expect(html).toContain("data-ask-globee-new");
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).not.toContain("data-ask-globee-history-row");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expectNoThreadFixture(html);
    expect(from).toHaveBeenCalledWith("conversations");
    expect(from).not.toHaveBeenCalledWith("titles");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
  });

  it("does not list HISTORY rows on landing even when the org has threads", async () => {
    stubClient({
      conversations: [
        {
          id: THREAD,
          title: "What needs attention",
          pinned_at: null,
          created_at: "2026-08-19T11:00:00.000Z",
          updated_at: "2026-08-19T11:10:00.000Z",
        },
      ],
    });
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-landing");
    expect(html).toContain("data-ask-globee-clock");
    expect(html).toContain("data-ask-globee-new");
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).not.toContain("data-ask-globee-history-row");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(pageSrc).toContain("AskGlobeeLanding");
    expect(pageSrc).toContain("conversations={sortAskGlobeeHistory");
  });

  it("shows the same landing for Premium", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-gate");
    expectNoThreadFixture(html);
  });

  it("keeps staff without a client org on the notification inbox", async () => {
    const { rpc, from } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true, hasOrg: false }) as never);

    const html = await renderPage({ thread: THREAD, q: "What needs attention" });
    expect(html).toContain("data-messages-inbox");
    expect(html).toContain(MESSAGES_EMPTY);
    expect(html).not.toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expectNoCatalogLeak(html);
    expect(vi.mocked(getActiveOrgTier)).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("my_notifications");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
    expect(from).not.toHaveBeenCalledWith("conversations");
  });

  it("treats staff with an active client org by that org's tier", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-messages-inbox");
    expectNoThreadFixture(html);
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(MessagesPage()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("MessagesPage Ask Globee persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens 247:295 chrome from a persisted org thread, not my_findings", async () => {
    const { eq, rpc, from } = stubClient({
      conversations: [
        {
          id: THREAD,
          title: "What needs attention",
          pinned_at: null,
          created_at: "2026-08-19T11:00:00.000Z",
          updated_at: "2026-08-19T11:10:00.000Z",
        },
      ],
      messages: [
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
    });
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ email: "ada@example.com" }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage({ thread: THREAD });

    expect(from).toHaveBeenCalledWith("conversations");
    expect(from).toHaveBeenCalledWith("conversation_messages");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
    expect(html).toContain("data-ask-globee-thread");
    expect(html).toContain("What needs attention");
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain(">A<");
    expect(html).toContain(ASK_GLOBEE.attributionName);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).not.toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(pageSrc).toContain("conversations={sortAskGlobeeHistory");
  });

  it("shows thinking chrome on a landing-originated open user turn", async () => {
    const { rpc } = stubClient({
      conversations: [
        {
          id: THREAD,
          title: "What is blocking a title",
          pinned_at: null,
          created_at: "2026-08-19T11:00:00.000Z",
          updated_at: "2026-08-19T11:00:00.000Z",
        },
      ],
      messages: [
        {
          id: USER_MSG,
          role: "user",
          body: "What is blocking a title",
          lead: null,
          follow: null,
          thumbs: null,
          created_at: "2026-08-19T11:00:00.000Z",
        },
      ],
    });
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ email: "ada@example.com" }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage({ thread: THREAD });
    expect(html).toContain("data-ask-globee-thread");
    expect(html).toContain("What is blocking a title");
    expect(html).toContain("data-ask-globee-thinking");
    expect(html).toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).toContain("…");
    expect(html).toContain('data-ask-globee-lead-slot=""');
    expect(html).toContain(ASK_GLOBEE.escToCancel);
    expect(html).toContain('data-ask-globee-stop=""');
    expect(html).not.toContain(ASK_GLOBEE.findingSignal);
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain("Looking at The Winter Line");
    expect(html).not.toContain("data-ask-globee-landing");
    expect(html).not.toContain(ASK_GLOBEE.emptyBlocking);
    expect(html).not.toContain("Winter Line");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
  });

  it("ignores a leftover ?q= rewrite and stays on landing", async () => {
    const { rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage({ q: "What needs attention" });
    expect(html).toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-thread");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
  });
});
