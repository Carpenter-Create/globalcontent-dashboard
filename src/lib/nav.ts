import {
  LayoutDashboard,
  Clapperboard,
  Send,
  Activity,
  Sparkles,
  Inbox,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ASK_GLOBEE } from "@/lib/ask-globee";

export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };

// GC's flat nav — only what exists or is v1-scoped. Deferred until their slices land:
// Statements, Settings. Ask Globee is the /messages destination (href unchanged).
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Titles", href: "/titles", icon: Clapperboard },
  { label: "Deliveries", href: "/deliveries", icon: Send },
  { label: "Catalog Health", href: "/catalog-health", icon: Activity },
  { label: ASK_GLOBEE.headline, href: "/messages", icon: Sparkles },
];

// Staff-only operator surfaces. Rendered by SideNav only when isGcStaff is true;
// the (operator) layout remains the authorization gate for these hrefs.
export const GC_NAV: NavItem[] = [
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
