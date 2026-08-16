"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { OrganizationSwitcher } from "./organization-switcher";
import { UserMenu } from "./user-menu";
import { SideNav } from "./side-nav";
import { cn } from "@/lib/cn";

type Org = { id: string; name: string };

// Shell composition ported from watershedportal, rethemed to GC tokens. Fixed sidebar +
// sticky header + centered content frame. The sidebar collapses to an icon-only rail; the
// state persists in a cookie (read by the (app) layout → `defaultCollapsed`, so there's no
// flash) and, when collapsed, overrides `--sidebar-width` so the header + main follow.
export function AppShell({
  email,
  orgs,
  activeOrgId,
  messagesUnread,
  isGcStaff = false,
  defaultCollapsed = false,
  children,
}: {
  email: string;
  orgs: Org[];
  activeOrgId: string | null;
  /** Promise, not a number — resolved inside SideNav's Suspense boundary so the
   *  shell paints without waiting on the badge query. */
  messagesUnread: Promise<number>;
  isGcStaff?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();
  // The catalog opts out of the centered width cap so its hero can bleed full-width
  // (edge of sidebar → right edge). That page then manages its own content max-width.
  const fullBleed = pathname === "/titles";

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `gc_sidebar_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  return (
    <div
      className="min-h-dvh"
      style={
        collapsed
          ? ({ "--sidebar-width": "var(--sidebar-width-collapsed)" } as React.CSSProperties)
          : undefined
      }
    >
      <aside
        className="fixed left-0 top-0 z-30 flex h-dvh flex-col border-r border-hairline bg-surface-muted"
        style={{ width: "var(--sidebar-width)" }}
      >
        <div
          className={cn("flex items-center px-2", collapsed ? "justify-center" : "gap-2")}
          style={{ height: "var(--header-height)" }}
        >
          {!collapsed ? (
            <span className="flex-1 truncate pl-1 t-label text-ink-2">Global Content</span>
          ) : null}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pt-1">
          <SideNav messagesUnread={messagesUnread} isGcStaff={isGcStaff} collapsed={collapsed} />
        </div>
      </aside>

      <header
        className={cn(
          "sticky top-0 z-40 flex items-center gap-4 border-b border-hairline bg-canvas/80 px-6 backdrop-blur",
          pathname === "/" ? "justify-end" : "justify-between",
        )}
        style={{ height: "var(--header-height)", marginLeft: "var(--sidebar-width)" }}
      >
        {pathname === "/" ? null : (
          <OrganizationSwitcher orgs={orgs} activeOrgId={activeOrgId} />
        )}
        <div className="flex items-center gap-3">
          <UserMenu email={email} />
        </div>
      </header>

      <main
        style={{
          marginLeft: "var(--sidebar-width)",
          minHeight: "calc(100dvh - var(--header-height))",
        }}
      >
        {fullBleed ? (
          <div className="w-full pb-24">{children}</div>
        ) : (
          <div className="mx-auto w-full px-6 pb-24 pt-8" style={{ maxWidth: "var(--page-max-width)" }}>
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
