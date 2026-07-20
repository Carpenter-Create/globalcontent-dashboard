import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// First GC-only surface. Gate on gc_staff membership (RLS returns the caller's
// own row only if they are GC). Non-GC users are redirected to the client app.
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

  return (
    <div className="mx-auto max-w-[1080px] px-12 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div className="flex items-baseline gap-6">
          <span className="t-subhead text-ink">Global Content</span>
          <nav className="flex gap-4">
            <Link href="/gc/review" className="t-body-sm text-ink-2 hover:text-ink">Review</Link>
            <Link href="/gc/vendors" className="t-body-sm text-ink-2 hover:text-ink">Vendors</Link>
            <Link href="/gc/deliveries" className="t-body-sm text-ink-2 hover:text-ink">Deliveries</Link>
          </nav>
        </div>
        <span className="t-body-sm text-ink-3">GC {staff.role.replace("gc_", "").replace("_", " ")}</span>
      </div>
      {children}
    </div>
  );
}
