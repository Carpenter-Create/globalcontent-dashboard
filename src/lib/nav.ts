import {
  LayoutDashboard,
  Clapperboard,
  Send,
  Activity,
  MessageSquare,
  Inbox,
  Store,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };

// GC's flat nav — only what exists or is v1-scoped. Deferred until their slices land:
// Statements, Ask Globee, Settings. (Dashboard = the §19 attention queue.)
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Titles", href: "/titles", icon: Clapperboard },
  { label: "Deliveries", href: "/deliveries", icon: Send },
  { label: "Catalog Health", href: "/catalog-health", icon: Activity },
  { label: "Messages", href: "/messages", icon: MessageSquare },
];

// Staff-only operator surfaces. Rendered by SideNav only when isGcStaff is true;
// the (operator) layout remains the authorization gate for these hrefs.
export const GC_NAV: NavItem[] = [
  { label: "Queue", href: "/queue", icon: Inbox },
  { label: "GC Deliveries", href: "/gc/deliveries", icon: Send },
  { label: "Vendors", href: "/vendors", icon: Store },
];
