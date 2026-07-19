import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PaymentCheckout } from "./payment-checkout";

// On-domain payment surface (PAY1). Only reachable for an awaiting_payment org.
export default async function PayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const org = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations)
    ?.organizations;
  if (!org) redirect("/");
  if (org.status === "active") redirect("/");
  if (org.status !== "awaiting_payment") redirect("/agreement"); // registered → pick a tier first

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <span className="t-label text-ink-3">Global Content · {org.name}</span>
        <h1 className="t-subhead text-ink">Complete your subscription</h1>
      </div>
      <PaymentCheckout />
    </main>
  );
}
