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

describe("MessagesPage surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubInbox();
  });

  it("shows the Access upgrade gate for an Access client", async () => {
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
    expect(html).not.toContain("data-ask-globee-thread");
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).not.toContain("data-messages-inbox");
  });

  it("defaults a missing readable tier to the Access gate", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue(null);

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-thread");
  });

  it("shows the 247:295 thread for Pro and never the Access gate", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ email: "ada@example.com" }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-thread");
    expect(html).toContain(ASK_GLOBEE.answerLead);
    expect(html).toContain(">A<");
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
  });

  it("shows the same authorized thread for Premium", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-thread");
    expect(html).not.toContain("data-ask-globee-gate");
  });

  it("keeps staff without a client org on the notification inbox", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true, hasOrg: false }) as never);

    const html = await renderPage();
    expect(html).toContain("data-messages-inbox");
    expect(html).toContain(MESSAGES_EMPTY);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-thread");
    expect(vi.mocked(getActiveOrgTier)).not.toHaveBeenCalled();
  });

  it("treats staff with an active client org by that org's tier", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ isGcStaff: true }) as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    const html = await renderPage();
    expect(html).toContain("data-ask-globee-thread");
    expect(html).not.toContain("data-messages-inbox");
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(MessagesPage()).rejects.toThrow("REDIRECT:/login");
  });
});
