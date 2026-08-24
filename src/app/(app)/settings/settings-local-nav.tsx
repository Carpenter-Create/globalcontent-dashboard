"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  SETTINGS_LOCAL_NAV,
  settingsSection,
  type SettingsSection,
} from "@/lib/settings";

// 600:881 local nav — Dashboard / Profile / Agreements. Active is a
// muted wash. Dashboard is the back door to /. Do not add Titles or
// Appearance here.
export function SettingsLocalNav() {
  const [section, setSection] = useState<SettingsSection>("profile");

  useEffect(() => {
    const sync = () => setSection(settingsSection(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <nav data-settings-local-nav="" className="flex flex-col gap-[var(--space-2)]">
      {SETTINGS_LOCAL_NAV.map((item) => {
        const active = item.kind !== "dashboard" && item.kind === section;
        return (
          <Link
            key={item.kind}
            href={item.href}
            data-settings-local-nav-item={item.kind}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center rounded-[var(--radius)] px-3 py-2 t-body-sm leading-4",
              item.kind === "dashboard" ? "gap-1" : undefined,
              active
                ? "bg-surface-muted font-normal text-ink"
                : "font-normal text-ink-2 hover:bg-surface-muted hover:text-ink",
            )}
          >
            {item.kind === "dashboard" ? (
              <ChevronLeft className="size-4 shrink-0" strokeWidth={1.33} />
            ) : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
