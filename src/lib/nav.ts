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

// Adam's Grok bee — Figma K0vd70n4Xvftm0aSpuWu77 Bee/16 18:3 and Bee/64 18:2.
// Display the already-cropped 16 in the size-4 slot. Keep 64 for 2x.
// Not the padded Design 483:532 export. Do not invent an SVG.
export const ASK_GLOBEE_NAV_MARK = {
  src16: "/ask-globee/ask-globee-16.png",
  src64: "/ask-globee/ask-globee-64.png",
  displaySrc: "/ask-globee/ask-globee-16.png",
  lock: "408fa5f5",
  fillClass: "size-4",
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
