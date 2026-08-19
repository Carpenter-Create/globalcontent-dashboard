import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { getActiveOrgTier } from "@/lib/org-tier";
import {
  canRenderAskGlobeeLanding,
  readAskGlobeePrompt,
  resolveMessagesSurface,
} from "@/lib/ask-globee";
import { buildAskGlobeeAnswer } from "@/lib/ask-globee-answer";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import { userMenuAvatarInitial } from "@/lib/user-menu";
import { AccessUpgradeGate } from "@/components/messages/access-upgrade-gate";
import { AskGlobeeLanding } from "@/components/messages/ask-globee-landing";
import { AskGlobeeThread } from "@/components/messages/ask-globee-thread";
import { NotificationInbox } from "@/components/messages/notification-inbox";

// Access `/messages` is the Ask Globee upgrade gate (Figma 305:320).
// Pro/Premium see the 7:73 landing, then 247:295 chrome after send.
// Staff without a client org keep the existing notification inbox.
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
    const prompt = readAskGlobeePrompt(await searchParams);
    if (!prompt) {
      return <AskGlobeeLanding />;
    }

    const supabase = await createClient();
    const org = ctx.activeOrg;
    const { data: titleRows } = await supabase
      .from("titles")
      .select("id, title, status, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .range(...rangeFor(UNPAGINATED_MAX));
    const titles = titleRows ?? [];
    const { data: allFindings } = await supabase.rpc("my_findings");
    const answer = buildAskGlobeeAnswer({
      prompt,
      titles,
      findings: allFindings ?? [],
      orgId: org.id,
      now: new Date(),
      bound: UNPAGINATED_MAX,
    });

    return (
      <AskGlobeeThread
        initials={userMenuAvatarInitial(ctx.user.email)}
        prompt={prompt}
        answer={answer}
      />
    );
  }

  return <AccessUpgradeGate />;
}
