import {
  LayoutDashboard,
  Clapperboard,
  Send,
  Activity,
  MessageSquare,
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
