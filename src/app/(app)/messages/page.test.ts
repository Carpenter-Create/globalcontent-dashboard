import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgTier } from "@/lib/org-tier";
import { ASK_GLOBEE } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import { MESSAGES_EMPTY } from "@/lib/notifications";
import MessagesPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-tier", () => ({ getActiveOrgTier: vi.fn() }));

const pageSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

const LEAK_TITLE = "ACCESS_MUST_NOT_SEE_TITLE";
const LEAK_FINDING = "ACCESS_MUST_NOT_SEE_SYNOPSIS";
const OTHER_ORG_FINDING = "SECRET_OTHER_ORG";

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
  titles = [
    {
      id: "t-cut",
      title: "Harbor Cut",
      status: "draft",
      created_at: "2026-08-16T00:00:00.000Z",
    },
  ],
  findings = [
    {
      org_id: "org-1",
      entity_id: "t-cut",
      message: "Synopsis is required.",
      severity: "high",
    },
    {
      org_id: "org-2",
      entity_id: "t-other",
      message: OTHER_ORG_FINDING,
      severity: "high",
    },
    {
      org_id: "org-1",
      entity_id: "missing-title",
      message: "ORPHAN_FINDING",
      severity: "high",
    },
  ],
}: {
  notifications?: unknown[];
  titles?: { id: string; title: string; status: string; created_at: string }[];
  findings?: {
    org_id: string;
    entity_id: string;
    message?: string | null;
    severity?: string | null;
  }[];
} = {}) {
  const eq = vi.fn();
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return titlesChain;
    },
    order: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: titles, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    throw new Error(`unexpected from(${table})`);
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_notifications") return { data: notifications, error: null };
    if (name === "my_findings") return { data: findings, error: null };
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
    expectNoThreadFixture(html);
  });

  it("shows the Access upgrade gate and never the landing, thread, or findings", async () => {
    stubClient({
      titles: [
        {
          id: "t1",
          title: LEAK_TITLE,
          status: "draft",
          created_at: "2026-08-15T00:00:00.000Z",
        },
      ],
      findings: [
        { org_id: "org-1", entity_id: "t1", message: LEAK_FINDING, severity: "high" },
        { org_id: "org-2", entity_id: "t2", message: OTHER_ORG_FINDING, severity: "high" },
      ],
    });
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("access");

    const html = await renderPage({ q: "What needs attention" });

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

    const html = await renderPage({ q: "What needs attention" });
    expect(html).toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expectNoCatalogLeak(html);
  });

  it("shows the 7:73 landing for Pro and never the Access gate or fixture thread", async () => {
    const { rpc } = stubClient();
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
    expect(html).not.toContain("HISTORY");
    expect(html).not.toContain("History");
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expectNoThreadFixture(html);
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
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
    const { rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true, hasOrg: false }) as never);

    const html = await renderPage({ q: "What needs attention" });
    expect(html).toContain("data-messages-inbox");
    expect(html).toContain(MESSAGES_EMPTY);
    expect(html).not.toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expectNoCatalogLeak(html);
    expect(vi.mocked(getActiveOrgTier)).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("my_notifications");
    expect(rpc).not.toHaveBeenCalledWith("my_findings");
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

describe("MessagesPage Ask Globee send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens 247:295 chrome with the caller's prompt and org-filtered findings", async () => {
    const { eq, rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ email: "ada@example.com" }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage({ q: "What needs attention" });

    expect(rpc).toHaveBeenCalledWith("my_findings");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(html).toContain("data-ask-globee-thread");
    expect(html).toContain("What needs attention");
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain(">A<");
    expect(html).toContain(ASK_GLOBEE.attributionName);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).not.toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain(OTHER_ORG_FINDING);
    expect(html).not.toContain("ORPHAN_FINDING");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
  });

  it("tells the truth when the catalog is empty", async () => {
    stubClient({ titles: [], findings: [] });
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    const html = await renderPage({ q: "What needs attention" });
    expect(html).toContain(CATALOG_HEALTH_EMPTY);
    expect(html).not.toContain("Artwork missing");
    expect(html).not.toContain("Winter Line");
  });

  it("answers unmapped free text with the honest capability line", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage({ q: "How much revenue did Harbor Cut make?" });
    expect(html).toContain(ASK_GLOBEE.capability);
    expect(html).toContain("How much revenue did Harbor Cut make?");
    expect(html).not.toContain("Synopsis is required.");
  });
});
