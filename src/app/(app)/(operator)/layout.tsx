import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// GC-operator surfaces (Queue, Vendors) render INSIDE the main client AppShell — same sidebar
// as the rest of the portal, no separate area. This route group ((operator) = no URL segment)
// adds only the gc_staff gate; the shell is provided by the parent (app) layout. Non-GC users
// are bounced to the client home. (The gate is the security boundary — sidebar links are
// already hidden from non-GC, but a direct URL hit must still be blocked here.)
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("gc_staff")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!staff) redirect("/");

  return <>{children}</>;
}
