import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { userMenuAvatarInitial } from "@/lib/user-menu";
import { getActiveOrgTier } from "@/lib/org-tier";
import { canRenderAskGlobeeThread, resolveMessagesSurface } from "@/lib/ask-globee";
import { AccessUpgradeGate } from "@/components/messages/access-upgrade-gate";
import { AskGlobeeThread } from "@/components/messages/ask-globee-thread";
import { NotificationInbox } from "@/components/messages/notification-inbox";

// Access `/messages` is the Ask Globee upgrade gate (Figma 305:320).
// Pro/Premium may see the locked answered-thread fixture (247:295).
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

  if (canRenderAskGlobeeThread(surface)) {
    return <AskGlobeeThread initials={userMenuAvatarInitial(ctx.user.email)} />;
  }

  return <AccessUpgradeGate />;
}
