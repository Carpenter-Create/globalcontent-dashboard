"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  SETTINGS_LOCAL_NAV,
  SETTINGS_RAIL_ACTIVE_CLASS,
  SETTINGS_RAIL_CHEVRON_CLASS,
  SETTINGS_RAIL_DASHBOARD_CLASS,
  SETTINGS_RAIL_IDLE_CLASS,
  SETTINGS_RAIL_ITEM_CLASS,
  SETTINGS_RAIL_NAV_CLASS,
  settingsRailActive,
  settingsSection,
  type SettingsSection,
} from "@/lib/settings";

// 600:881 settings rail — occupies the 220 Access slot. Dashboard is
// 16 chevron + 15 Regular. Active is a muted wash that follows the
// hash. Do not add Titles, Appearance, Account, Users, or API.
export function SettingsRail() {
  const [section, setSection] = useState<SettingsSection>("profile");

  useEffect(() => {
    const sync = () => setSection(settingsSection(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <nav data-settings-rail-nav="" className={SETTINGS_RAIL_NAV_CLASS}>
      {SETTINGS_LOCAL_NAV.map((item) => {
        const active = settingsRailActive(item.kind, section);
        return (
          <Link
            key={item.kind}
            href={item.href}
            data-settings-rail-item={item.kind}
            aria-current={active ? "page" : undefined}
            className={cn(
              SETTINGS_RAIL_ITEM_CLASS,
              item.kind === "dashboard" ? SETTINGS_RAIL_DASHBOARD_CLASS : undefined,
              active ? SETTINGS_RAIL_ACTIVE_CLASS : SETTINGS_RAIL_IDLE_CLASS,
            )}
          >
            {item.kind === "dashboard" ? (
              <ChevronLeft className={SETTINGS_RAIL_CHEVRON_CLASS} strokeWidth={1.33} />
            ) : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
