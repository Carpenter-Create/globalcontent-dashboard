"use server";

import { revalidatePath } from "next/cache";

import {
  ASK_GLOBEE,
  askGlobeeComposerSubmit,
  askGlobeeConversationTitle,
  canRenderAskGlobeeLanding,
  isAskGlobeeThreadId,
  resolveMessagesSurface,
} from "@/lib/ask-globee";
import { buildAskGlobeeAnswer } from "@/lib/ask-globee-answer";
import {
  nextAskGlobeeThumb,
  type AskGlobeeThumb,
} from "@/lib/ask-globee-conversations";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import { getActiveOrgTier } from "@/lib/org-tier";
import { getOrgContext, type OrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

type ActionError = { error: string };
type Client = Awaited<ReturnType<typeof createClient>>;

async function requireAskGlobeeOrg(): Promise<
  { ctx: OrgContext & { activeOrg: NonNullable<OrgContext["activeOrg"]> } } | ActionError
> {
  const ctx = await getOrgContext();
  if (!ctx) return { error: "Not authenticated." };
  const tier = ctx.activeOrg ? await getActiveOrgTier(ctx.activeOrg.id) : null;
  const surface = resolveMessagesSurface({
    isGcStaff: ctx.isGcStaff,
    hasActiveOrg: !!ctx.activeOrg,
    tier,
  });
  if (!canRenderAskGlobeeLanding(surface) || !ctx.activeOrg) {
    return { error: "Not authorized." };
  }
  return { ctx: { ...ctx, activeOrg: ctx.activeOrg } };
}

async function loadOrgAnswer(supabase: Client, orgId: string, prompt: string) {
  const { data: titleRows } = await supabase
    .from("titles")
    .select("id, title, status, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(...rangeFor(UNPAGINATED_MAX));
  const { data: allFindings } = await supabase.rpc("my_findings");
  return buildAskGlobeeAnswer({
    prompt,
    titles: titleRows ?? [],
    findings: allFindings ?? [],
    orgId,
    now: new Date(),
    bound: UNPAGINATED_MAX,
  });
}

export async function startAskGlobeeConversation(
  prompt: string,
): Promise<{ conversationId?: string; error?: string }> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  const next = askGlobeeComposerSubmit(prompt);
  if (!next) return { error: "Ask a question or give a command." };

  const supabase = await createClient();
  const orgId = gate.ctx.activeOrg.id;
  const answer = await loadOrgAnswer(supabase, orgId, next);
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      org_id: orgId,
      title: askGlobeeConversationTitle(next),
      created_by: gate.ctx.user.id,
    })
    .select("id")
    .single();
  if (conversationError || !conversation) {
    return { error: conversationError?.message ?? "Could not start the conversation." };
  }

  const { error: userError } = await supabase.from("conversation_messages").insert({
    org_id: orgId,
    conversation_id: conversation.id,
    role: "user",
    body: next,
  });
  if (userError) return { error: userError.message };

  const { error: globeeError } = await supabase.from("conversation_messages").insert({
    org_id: orgId,
    conversation_id: conversation.id,
    role: "globee",
    body: answer.lead,
    lead: answer.lead,
    follow: answer.follow,
  });
  if (globeeError) return { error: globeeError.message };

  revalidatePath("/messages");
  return { conversationId: conversation.id };
}

export async function appendAskGlobeeTurn(
  conversationId: string,
  prompt: string,
): Promise<ActionError | Record<string, never>> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  if (!isAskGlobeeThreadId(conversationId)) return { error: "Conversation not found." };
  const next = askGlobeeComposerSubmit(prompt);
  if (!next) return { error: "Ask a question or give a command." };

  const supabase = await createClient();
  const orgId = gate.ctx.activeOrg.id;
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!conversation) return { error: "Conversation not found." };

  const answer = await loadOrgAnswer(supabase, orgId, next);
  const { error: userError } = await supabase.from("conversation_messages").insert({
    org_id: orgId,
    conversation_id: conversationId,
    role: "user",
    body: next,
  });
  if (userError) return { error: userError.message };

  const { error: globeeError } = await supabase.from("conversation_messages").insert({
    org_id: orgId,
    conversation_id: conversationId,
    role: "globee",
    body: answer.lead,
    lead: answer.lead,
    follow: answer.follow,
  });
  if (globeeError) return { error: globeeError.message };

  revalidatePath("/messages");
  return {};
}

export async function setAskGlobeeThumb(
  messageId: string,
  clicked: AskGlobeeThumb,
): Promise<ActionError | { thumbs: AskGlobeeThumb | null }> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  if (!isAskGlobeeThreadId(messageId)) return { error: "Message not found." };

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("conversation_messages")
    .select("id, role, thumbs, org_id")
    .eq("id", messageId)
    .eq("org_id", gate.ctx.activeOrg.id)
    .maybeSingle();
  if (!message || message.role !== "globee") return { error: "Message not found." };

  const thumbs = nextAskGlobeeThumb(message.thumbs, clicked);
  const { error } = await supabase
    .from("conversation_messages")
    .update({ thumbs })
    .eq("id", messageId)
    .eq("org_id", gate.ctx.activeOrg.id);
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return { thumbs };
}

export async function renameAskGlobeeConversation(
  conversationId: string,
  title: string,
): Promise<ActionError | { title: string }> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  if (!isAskGlobeeThreadId(conversationId)) return { error: "Conversation not found." };
  const next = askGlobeeConversationTitle(title);
  if (!next) return { error: ASK_GLOBEE.renameTitle };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ title: next })
    .eq("id", conversationId)
    .eq("org_id", gate.ctx.activeOrg.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Conversation not found." };
  revalidatePath("/messages");
  return { title: next };
}

export async function pinAskGlobeeConversation(
  conversationId: string,
  pinned: boolean,
): Promise<ActionError | { pinnedAt: string | null }> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  if (!isAskGlobeeThreadId(conversationId)) return { error: "Conversation not found." };

  const pinnedAt = pinned ? new Date().toISOString() : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ pinned_at: pinnedAt })
    .eq("id", conversationId)
    .eq("org_id", gate.ctx.activeOrg.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Conversation not found." };
  revalidatePath("/messages");
  return { pinnedAt };
}

export async function deleteAskGlobeeConversation(
  conversationId: string,
): Promise<ActionError | Record<string, never>> {
  const gate = await requireAskGlobeeOrg();
  if ("error" in gate) return gate;
  if (!isAskGlobeeThreadId(conversationId)) return { error: "Conversation not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("org_id", gate.ctx.activeOrg.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Conversation not found." };
  revalidatePath("/messages");
  return {};
}
