"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { UserMenu } from "./user-menu";
import { SideNav } from "./side-nav";
import { SettingsRail } from "./settings-rail";
import { MobileNav } from "./mobile-nav";
import { MessagesAppHeader } from "./messages-app-header";
import { TitlesHeaderSearch } from "@/components/titles/titles-header-search";
import { AskGlobeeChromeProvider } from "@/components/messages/ask-globee-chrome";
import { cn } from "@/lib/cn";
import type { MessagesSurface } from "@/lib/ask-globee";
import { isSettingsPath, SETTINGS_RAIL_PAD_CLASS } from "@/lib/settings";

type Org = { id: string; name: string };

// Shell composition ported from watershedportal, rethemed to GC tokens. Fixed sidebar +
// sticky header + centered content frame. The sidebar collapses to an icon-only rail; the
// state persists in a cookie (read by the (app) layout → `defaultCollapsed`, so there's no
// flash) and, when collapsed, overrides `--sidebar-width` so the header + main follow.
// Phone: the rail is gone (hidden + width tokens collapse). A header hamburger opens a
// bottom sheet — client destinations, or those plus staff destinations when
// isGcStaff. Desktop 1:2 rail is unchanged.
// /settings paths: the Access destinations leave. One 220 rail (pad 16)
// occupies that slot — ← Dashboard / Profile / Agreements / Refer a
// friend. Not a second column. Collapse and the phone hamburger stay
// off these routes. Header avatar stays.
export function AppShell({
  email,
  name,
  messagesUnread,
  isGcStaff = false,
  defaultCollapsed = false,
  messagesSurface = "staff-inbox",
  children,
}: {
  email: string;
  name?: string | null;
  orgs: Org[];
  activeOrgId: string | null;
  /** Promise, not a number — resolved inside SideNav's Suspense boundary so the
   *  shell paints without waiting on the badge query. */
  messagesUnread: Promise<number>;
  isGcStaff?: boolean;
  defaultCollapsed?: boolean;
  messagesSurface?: MessagesSurface;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();
  // The catalog opts out of the centered width cap so its hero can bleed full-width
  // (edge of sidebar → right edge). That page then manages its own content max-width.
  // Client `/` uses the locked Access frame (48 / 32) without restyling other pages.
  const titlesBleed = pathname === "/titles";
  const homePage = pathname === "/";
  const messagesPage = pathname === "/messages";
  const settingsPage = isSettingsPath(pathname);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `gc_sidebar_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  return (
    <AskGlobeeChromeProvider>
    <div
      className="min-h-dvh"
      style={
        collapsed && !settingsPage
          ? ({ "--sidebar-width": "var(--sidebar-width-collapsed)" } as React.CSSProperties)
          : undefined
      }
    >
      <aside
        className="fixed left-0 top-0 z-30 hidden h-dvh flex-col border-r border-hairline bg-surface md:flex"
        data-app-rail=""
        data-settings-rail={settingsPage ? "" : undefined}
        style={{ width: "var(--sidebar-width)" }}
      >
        <div
          className={cn(
            "flex items-center",
            settingsPage ? "px-[var(--space-4)]" : collapsed ? "justify-center px-3" : "gap-2 px-3",
          )}
          style={{ height: "var(--header-height)" }}
        >
          {settingsPage || !collapsed ? (
            <span className="flex-1 truncate t-body font-medium text-ink">Global Content</span>
          ) : null}
          {settingsPage ? null : (
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-surface-muted hover:text-ink-2"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" strokeWidth={1.33} />
              ) : (
                <PanelLeftClose className="size-4" strokeWidth={1.33} />
              )}
            </button>
          )}
        </div>
        <div
          className={cn("flex-1 overflow-y-auto", settingsPage ? SETTINGS_RAIL_PAD_CLASS : "pt-1")}
        >
          {settingsPage ? (
            <SettingsRail />
          ) : (
            <SideNav messagesUnread={messagesUnread} isGcStaff={isGcStaff} collapsed={collapsed} />
          )}
        </div>
      </aside>

      {/* Access header is avatar / account menu only — no org switcher on any route.
          Search mounts on the Access `/messages` gate, and on mobile `/titles`
          (528:542). Desktop 1:3, `/` 1:2, and `/titles/[id]` 1:4 stay avatar-only.
          Phone avatar opens 544:561. Hamburger stays the nav sheet. */}
      <header
        className="sticky top-0 z-40 flex items-center justify-end gap-4 border-b border-hairline bg-surface/85 px-[var(--space-6)] md:px-[var(--content-inset)] backdrop-blur"
        data-app-header=""
        style={{ height: "var(--header-height)", marginLeft: "var(--sidebar-width)" }}
      >
        <div data-app-header-leading="" className="mr-auto flex min-w-0 flex-1 items-center gap-2">
          {settingsPage ? null : <MobileNav isGcStaff={isGcStaff} />}
          {messagesPage ? <MessagesAppHeader surface={messagesSurface} /> : null}
          {titlesBleed ? <TitlesHeaderSearch /> : null}
        </div>
        <div className="flex items-center gap-3">
          <UserMenu email={email} name={name} />
        </div>
      </header>

      <main
        style={{
          marginLeft: "var(--sidebar-width)",
          minHeight: "calc(100dvh - var(--header-height))",
        }}
      >
        {titlesBleed ? (
          <div className="w-full pb-24">{children}</div>
        ) : homePage ? (
          <div
            className="w-full px-[var(--content-inset)] py-[var(--space-8)]"
            data-app-home-frame=""
          >
            {children}
          </div>
        ) : messagesPage ? (
          <div
            className="w-full p-[var(--content-inset)]"
            data-app-messages-frame=""
          >
            {children}
          </div>
        ) : (
          <div className="mx-auto w-full px-6 pb-24 pt-8" style={{ maxWidth: "var(--page-max-width)" }}>
            {children}
          </div>
        )}
      </main>
    </div>
    </AskGlobeeChromeProvider>
  );
}
