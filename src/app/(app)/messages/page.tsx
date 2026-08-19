import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { getActiveOrgTier } from "@/lib/org-tier";
import { canRenderAskGlobeeLanding, resolveMessagesSurface } from "@/lib/ask-globee";
import { AccessUpgradeGate } from "@/components/messages/access-upgrade-gate";
import { AskGlobeeLanding } from "@/components/messages/ask-globee-landing";
import { NotificationInbox } from "@/components/messages/notification-inbox";

// Access `/messages` is the Ask Globee upgrade gate (Figma 305:320).
// Pro/Premium see the 7:73 landing. The 247:295 fixture is not mounted here.
// Staff without a client org keep the existing notification inbox.
export default async function MessagesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const tier = ctx.activeOrg ? await getActiveOrgTier(ctx.activeOrg.id) : null;
  const surface = resolveMessagesSurface({
    isGcStaff: ctx.isGcStaff,
    hasActiveOrg: !!ctx.activeOrg,
    tier,
  });

  if (surface === "staff-inbox") {
    const supabase = await createClient();
    const { data: notifications } = await supabase.rpc("my_notifications");
    return <NotificationInbox notifications={notifications ?? []} />;
  }

  if (canRenderAskGlobeeLanding(surface)) {
    return <AskGlobeeLanding />;
  }

  return <AccessUpgradeGate />;
}
