import { OrganizationSwitcher } from "./organization-switcher";
import { UserMenu } from "./user-menu";
import { SideNav } from "./side-nav";
import { ThemeToggle } from "@/components/theme-toggle";

type Org = { id: string; name: string };

// Shell composition ported from watershedportal (sidebar 210px, header 56px, content
// max 1080px, content-inset 48px — all via GC layout tokens), Watershed vocabulary
// dropped. Fixed sidebar + sticky header + centered content frame.
export function AppShell({
  email,
  orgs,
  activeOrgId,
  messagesUnread = 0,
  isGcStaff = false,
  children,
}: {
  email: string;
  orgs: Org[];
  activeOrgId: string | null;
  messagesUnread?: number;
  isGcStaff?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <aside
        className="fixed left-0 top-0 z-30 flex h-dvh flex-col border-r border-hairline bg-surface-muted"
        style={{ width: "var(--sidebar-width)" }}
      >
        <div className="flex items-center px-4" style={{ height: "var(--header-height)" }}>
          <span className="t-label text-ink-2">Global Content</span>
        </div>
        <div className="flex-1 overflow-y-auto pt-2">
          <SideNav messagesUnread={messagesUnread} isGcStaff={isGcStaff} />
        </div>
      </aside>

      <header
        className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-hairline bg-canvas/80 px-6 backdrop-blur"
        style={{ height: "var(--header-height)", marginLeft: "var(--sidebar-width)" }}
      >
        <OrganizationSwitcher orgs={orgs} activeOrgId={activeOrgId} />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserMenu email={email} />
        </div>
      </header>

      <main
        style={{
          marginLeft: "var(--sidebar-width)",
          minHeight: "calc(100dvh - var(--header-height))",
        }}
      >
        <div
          className="mx-auto w-full px-6 pb-24 pt-8"
          style={{ maxWidth: "var(--page-max-width)" }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
