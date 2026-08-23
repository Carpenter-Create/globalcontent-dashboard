import {
  LayoutDashboard,
  Clapperboard,
  Send,
  Activity,
  Inbox,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ASK_GLOBEE } from "@/lib/ask-globee";

export type NavLucideItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  markSrc?: undefined;
  exact?: boolean;
};

export type NavImageItem = {
  label: string;
  href: string;
  icon?: undefined;
  markSrc: string;
  exact?: boolean;
};

export type NavItem = NavLucideItem | NavImageItem;

// Adam's 3/4 line bee — Design Figma Icon/ask-globee 483:532. Hash 028551fa.
// Four Design PNG exports are the source of truth. The 16 export is padded;
// the rail displays the 64, cropped/scaled into the same 16 box as Dashboard.
export const ASK_GLOBEE_NAV_MARK = {
  src16: "/ask-globee/ask-globee-16.png",
  src24: "/ask-globee/ask-globee-24.png",
  src32: "/ask-globee/ask-globee-32.png",
  src64: "/ask-globee/ask-globee-64.png",
  displaySrc: "/ask-globee/ask-globee-64.png",
  lock: "028551fa",
  // 24 CSS px of the 64 PNG, clipped to the 16 slot — fills the box instead
  // of shipping the inset/faint 16 export. Display box stays size-4.
  fillClass: "absolute left-1/2 top-1/2 size-6 max-w-none -translate-x-1/2 -translate-y-1/2",
} as const;

export function isNavImageItem(item: NavItem): item is NavImageItem {
  return typeof item.markSrc === "string";
}

// GC's flat nav — only what exists or is v1-scoped. Deferred until their slices land:
// Statements, Settings. Ask Globee is the /messages destination (href unchanged).
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Titles", href: "/titles", icon: Clapperboard },
  { label: "Deliveries", href: "/deliveries", icon: Send },
  { label: "Catalog Health", href: "/catalog-health", icon: Activity },
  {
    label: ASK_GLOBEE.headline,
    href: "/messages",
    markSrc: ASK_GLOBEE_NAV_MARK.displaySrc,
  },
];

// Staff-only operator surfaces. Rendered by SideNav only when isGcStaff is true;
// the (operator) layout remains the authorization gate for these hrefs.
export const GC_NAV: NavLucideItem[] = [
  { label: "Queue", href: "/queue", icon: Inbox },
  { label: "GC Deliveries", href: "/gc/deliveries", icon: Send },
  { label: "Vendors", href: "/vendors", icon: Store },
  { label: "Clients", href: "/gc/clients", icon: Users },
];

// Phone sheet copy. Client sheet is NAV only. Staff sheet is NAV + GC_NAV.
export const MOBILE_NAV = {
  open: "Open menu",
  close: "Close menu",
  sheet: "Menu",
} as const;

export function isClientNavActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function clientNavCurrent(pathname: string): NavItem {
  return NAV.find((item) => isClientNavActive(pathname, item)) ?? NAV[0];
}

// Client phone sheet stays the five NAV destinations. Staff already use those
// plus the operator set — do not leave them on a client-only menu.
export function mobileNavDestinations(isGcStaff: boolean): NavItem[] {
  return isGcStaff ? [...NAV, ...GC_NAV] : NAV;
}
