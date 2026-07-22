"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Store, Send, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

// GC operator side nav — mirrors the client SideNav rhythm (px-3 py-2, icon h-4).
// Flat sibling tabs, active on their own path prefix. Queue and Vendors are top-level GC
// routes (/queue, /vendors); Deliveries stays under /gc/ because /deliveries is a client
// route. Title detail lives under /gc/titles, so no tab highlights there (reached from Queue).
const GC_NAV: { label: string; href: string; icon: LucideIcon; exact?: boolean }[] = [
  { label: "Queue", href: "/queue", icon: Inbox },
  { label: "Vendors", href: "/vendors", icon: Store },
  { label: "Deliveries", href: "/gc/deliveries", icon: Send },
];

export function GcNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px px-2">
      {GC_NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
    </nav>
  );
}
