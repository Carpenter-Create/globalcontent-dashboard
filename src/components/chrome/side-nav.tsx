"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Store, type LucideIcon } from "lucide-react";

import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

// GC operator surfaces — shown only to GC staff, rendered INSIDE this same shell (no separate
// area). The delivery QUEUE is deliberately NOT here: "Deliveries" already exists in the client
// nav (a client's own deliveries), so a second "Deliveries" for a dual-role account is confusing.
// GC reaches the delivery queue from the Queue's "Ready to deliver" section instead.
const GC_NAV: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Queue", href: "/queue", icon: Inbox },
  { label: "Vendors", href: "/vendors", icon: Store },
];

// Nav row rhythm ported from watershedportal (px-3 py-2, text-[13px], gap-2.5,
// icon h-4 strokeWidth 1.5) — proportions kept, colors rethemed to GC tokens.
// GC staff (isGcStaff) additionally get a link into the GC operator area — clients never do.
export function SideNav({
  messagesUnread = 0,
  isGcStaff = false,
}: {
  messagesUnread?: number;
  isGcStaff?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px px-2">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        const unread = item.href === "/messages" ? messagesUnread : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 t-body-sm font-medium transition-colors",
              active
                ? "bg-surface text-ink"
                : "text-ink-3 hover:bg-surface hover:text-ink-2",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.5} />
            <span className="flex-1">{item.label}</span>
            {unread > 0 ? (
              <span className="min-w-4 rounded-full bg-accent px-1.5 text-center t-label text-[var(--accent-contrast)]">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
      {isGcStaff ? (
        <>
          <div className="mx-1 my-2 border-t border-hairline" />
          <span className="px-3 pb-1 t-label text-ink-3">Global Content</span>
          {GC_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 t-body-sm font-medium transition-colors",
                  active ? "bg-surface text-ink" : "text-ink-3 hover:bg-surface hover:text-ink-2",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </>
      ) : null}
    </nav>
  );
}
