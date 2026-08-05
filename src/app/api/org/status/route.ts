import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// The caller's active-owned org status — used by the post-payment poller to wait for the
// webhook's finalize_paid_signup to flip awaiting_payment → active before entering the app.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const org = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations)
    ?.organizations;

  return NextResponse.json({ status: org?.status ?? null });
}
