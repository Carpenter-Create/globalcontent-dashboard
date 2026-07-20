"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

// Nav row rhythm ported from watershedportal (px-3 py-2, text-[13px], gap-2.5,
// icon h-4 strokeWidth 1.5) — proportions kept, colors rethemed to GC tokens.
export function SideNav({ messagesUnread = 0 }: { messagesUnread?: number }) {
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
              <span className="min-w-4 rounded-full bg-accent px-1.5 text-center t-label text-[var(--band-ink)]">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
