import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { GcNav } from "./gc-nav";

// GC-only shell. Gate on gc_staff membership (RLS returns the caller's own row only if
// they are GC). Non-GC users are redirected to the client app. Left sidebar mirrors the
// client AppShell (Queue is the landing).
export default async function GcLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("gc_staff")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!staff) redirect("/");

  const roleLabel = staff.role.replace("gc_", "").replace(/_/g, " ");

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
          <GcNav />
        </div>
      </aside>

      <header
        className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-hairline bg-canvas/80 px-6 backdrop-blur"
        style={{ height: "var(--header-height)", marginLeft: "var(--sidebar-width)" }}
      >
        <span className="t-body-sm text-ink-3">GC operator</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <span className="t-body-sm text-ink-3">GC {roleLabel}</span>
        </div>
      </header>

      <main
        style={{
          marginLeft: "var(--sidebar-width)",
          minHeight: "calc(100dvh - var(--header-height))",
        }}
      >
        <div className="mx-auto w-full px-6 pb-24 pt-8" style={{ maxWidth: "var(--page-max-width)" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
