import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { getActiveOrgTier } from "@/lib/org-tier";
import {
  canRenderAskGlobeeLanding,
  readAskGlobeeThreadId,
  resolveMessagesSurface,
} from "@/lib/ask-globee";
import {
  sortAskGlobeeHistory,
  type AskGlobeeHistoryRow,
  type AskGlobeeStoredMessage,
} from "@/lib/ask-globee-conversations";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import { userMenuAvatarInitial } from "@/lib/user-menu";
import { AccessUpgradeGate } from "@/components/messages/access-upgrade-gate";
import { AskGlobeeLanding } from "@/components/messages/ask-globee-landing";
import { AskGlobeeThread } from "@/components/messages/ask-globee-thread";
import { NotificationInbox } from "@/components/messages/notification-inbox";

// Access `/messages` is the Ask Globee upgrade gate (Figma 305:320).
// Pro/Premium see the 7:73 landing. Clock opens past org conversations;
// plus is not on this empty home. Chip or composer send persists the user
// turn, then 247:295 chrome on that thread. Staff without a client org
// keep the inbox.
export default async function MessagesPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
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

  if (canRenderAskGlobeeLanding(surface) && ctx.activeOrg) {
    const threadId = readAskGlobeeThreadId(await searchParams);
    const supabase = await createClient();
    const org = ctx.activeOrg;

    if (threadId) {
      const { data: conversationRow } = await supabase
        .from("conversations")
        .select("id, title, pinned_at, created_at, updated_at")
        .eq("id", threadId)
        .eq("org_id", org.id)
        .maybeSingle();
      const conversation = conversationRow as AskGlobeeHistoryRow | null;
      if (conversation) {
        const { data: messageRows } = await supabase
          .from("conversation_messages")
          .select("id, role, body, lead, follow, thumbs, created_at")
          .eq("conversation_id", conversation.id)
          .eq("org_id", org.id)
          .order("created_at", { ascending: true })
          .range(...rangeFor(UNPAGINATED_MAX));
        const { data: historyRows } = await supabase
          .from("conversations")
          .select("id, title, pinned_at, created_at, updated_at")
          .eq("org_id", org.id)
          .range(...rangeFor(UNPAGINATED_MAX));
        return (
          <AskGlobeeThread
            initials={userMenuAvatarInitial(ctx.user.email)}
            conversation={conversation}
            messages={(messageRows ?? []) as AskGlobeeStoredMessage[]}
            conversations={sortAskGlobeeHistory((historyRows ?? []) as AskGlobeeHistoryRow[])}
          />
        );
      }
    }

    const { data: historyRows } = await supabase
      .from("conversations")
      .select("id, title, pinned_at, created_at, updated_at")
      .eq("org_id", org.id)
      .range(...rangeFor(UNPAGINATED_MAX));
    return (
      <AskGlobeeLanding
        conversations={sortAskGlobeeHistory((historyRows ?? []) as AskGlobeeHistoryRow[])}
      />
    );
  }

  return <AccessUpgradeGate />;
}
