"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useRef } from "react";
import { type LucideIcon } from "lucide-react";

import { GC_NAV, NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

// Access rail: 13px labels (--text-sm / t-body-sm), 16px Lucide at 1.33, muted grey wash when active.
// Collapsed mode is icon-only (labels/badges hidden; title tooltips; unread → accent dot).
export function SideNav({
  messagesUnread,
  isGcStaff = false,
  collapsed = false,
}: {
  messagesUnread: Promise<number>;
  isGcStaff?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  const router = useRouter();
  const warmed = useRef<Set<string>>(new Set());
  const warm = (href: string) => {
    if (warmed.current.has(href)) return;
    warmed.current.add(href);
    router.prefetch(href);
  };

  const row = (
    item: { label: string; href: string; icon: LucideIcon; exact?: boolean },
    badge: React.ReactNode = null,
  ) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        // VIEWPORT prefetch off, HOVER prefetch on. The sidebar renders on every page, so
        // viewport prefetch fired a full uncached render of EVERY destination on EVERY
        // navigation — ~400 invocations in one short session, all contending with the
        // navigation actually in flight. Hovering is a statement of intent: it warms the one
        // destination you are about to click, so the click lands on data already fetched
        // instead of paying ~360ms (network + render) with a skeleton in the meantime.
        // Deduped per href so re-hovering does not re-fire.
        prefetch={false}
        onMouseEnter={() => warm(item.href)}
        onFocus={() => warm(item.href)}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "relative flex items-center rounded-[var(--radius)] t-body-sm leading-4 transition-colors",
          collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-2",
          active
            ? "bg-surface-muted font-medium text-ink"
            : "font-normal text-ink-2 hover:bg-surface-muted hover:text-ink",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.33} />
        {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
        {badge}
      </Link>
    );
  };

  return (
    <nav className={cn("flex flex-col gap-2", collapsed ? "px-1.5" : "px-3")} data-side-nav="">
      {NAV.map((item) =>
        row(
          item,
          item.href === "/messages" ? (
            // Suspense so an unresolved badge never holds up the nav. Fallback is nothing
            // — an empty slot that fills in, rather than a spinner that draws the eye to a
            // decoration.
            <Suspense fallback={null}>
              <UnreadBadge count={messagesUnread} collapsed={collapsed} />
            </Suspense>
          ) : null,
        ),
      )}
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

// Unwraps the unread promise. Kept out of the critical render path because
// my_unread_count calls member_can() per notification row; a badge should not be able to
// delay the page it decorates.
function UnreadBadge({ count, collapsed }: { count: Promise<number>; collapsed: boolean }) {
  const unread = use(count);
  if (unread <= 0) return null;
  return collapsed ? (
    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
  ) : (
    <span className="min-w-4 rounded-full bg-accent px-1.5 text-center t-label text-[var(--accent-contrast)]">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
