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
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-tier", () => ({ getActiveOrgTier: vi.fn() }));

const pageSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

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

function stubInbox(list: unknown[] = []) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_notifications") return { data: list, error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  return rpc;
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await MessagesPage()).replaceAll("&#x27;", "'");
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

describe("MessagesPage surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubInbox();
  });

  it("does not mount AskGlobeeThread on the index", () => {
    expect(pageSrc).not.toContain("AskGlobeeThread");
    expect(pageSrc).not.toContain("ask-globee-thread");
    expect(pageSrc).toContain("AskGlobeeLanding");
  });

  it("shows the Access upgrade gate and never the landing or thread", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("access");

    const html = await renderPage();

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
  });

  it("defaults a missing readable tier to the Access gate", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue(null);

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
  });

  it("shows the 7:73 landing for Pro and never the Access gate or fixture thread", async () => {
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
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true, hasOrg: false }) as never);

    const html = await renderPage();
    expect(html).toContain("data-messages-inbox");
    expect(html).toContain(MESSAGES_EMPTY);
    expect(html).not.toContain("data-ask-globee-gate");
    expectNoLanding(html);
    expectNoThreadFixture(html);
    expect(vi.mocked(getActiveOrgTier)).not.toHaveBeenCalled();
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
