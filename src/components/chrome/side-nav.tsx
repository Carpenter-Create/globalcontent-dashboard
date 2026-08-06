"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Store, type LucideIcon } from "lucide-react";

import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

// GC operator surfaces — shown only to GC staff, rendered INSIDE this same shell. The delivery
// QUEUE is reached from the Queue's "Ready to deliver" section, not a second "Deliveries" here.
const GC_NAV: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Queue", href: "/queue", icon: Inbox },
  { label: "Vendors", href: "/vendors", icon: Store },
];

// Tightened nav (2026-07-22): px-2.5 py-1.5, 16px icons, 13px medium text. Collapsed mode
// renders an icon-only rail (labels/badges hidden; title tooltips; unread → accent dot).
export function SideNav({
  messagesUnread = 0,
  isGcStaff = false,
  collapsed = false,
}: {
  messagesUnread?: number;
  isGcStaff?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  const row = (
    item: { label: string; href: string; icon: LucideIcon; exact?: boolean },
    unread = 0,
  ) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        // prefetch=false: the sidebar renders on EVERY page, so viewport prefetch fired a
        // full uncached render of every destination on every navigation — measured at ~400
        // server invocations across a short clicking session, each doing its own
        // getOrgContext DB work and contending with the navigation actually in flight.
        // loading.tsx still gives instant feedback on click; the render is only ~180ms.
        prefetch={false}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "relative flex items-center rounded-[var(--radius-sm)] t-body-sm font-medium leading-5 transition-colors",
          collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1.5",
          active ? "bg-surface text-ink" : "text-ink-3 hover:bg-surface hover:text-ink-2",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
        {!collapsed && unread > 0 ? (
          <span className="min-w-4 rounded-full bg-accent px-1.5 text-center t-label text-[var(--accent-contrast)]">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
        {collapsed && unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav className={cn("flex flex-col gap-px", collapsed ? "px-1.5" : "px-2")}>
      {NAV.map((item) => row(item, item.href === "/messages" ? messagesUnread : 0))}
      {isGcStaff ? (
        <>
          <div className="mx-1 my-2 border-t border-hairline" />
          {!collapsed ? (
            <span className="px-2.5 pb-1 t-label text-ink-3">Global Content</span>
          ) : null}
          {GC_NAV.map((item) => row(item))}
        </>
      ) : null}
    </nav>
  );
}
