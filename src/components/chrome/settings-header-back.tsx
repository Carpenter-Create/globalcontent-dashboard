"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import {
  SETTINGS,
  SETTINGS_HEADER_BACK_CLASS,
  SETTINGS_RAIL_CHEVRON_CLASS,
} from "@/lib/settings";

// 623:785 — phone /settings left slot. Same ← Dashboard as the
// 600:881 rail. 16 chevron + 15 Regular, gap 8, href /. Hidden at
// md. Not a new IA. Do not restyle the rail or Identity.
export function SettingsHeaderBack() {
  return (
    <Link
      href={SETTINGS.dashboardHref}
      data-settings-header-back=""
      className={SETTINGS_HEADER_BACK_CLASS}
    >
      <ChevronLeft className={SETTINGS_RAIL_CHEVRON_CLASS} strokeWidth={1.33} />
      {SETTINGS.dashboard}
    </Link>
  );
}
