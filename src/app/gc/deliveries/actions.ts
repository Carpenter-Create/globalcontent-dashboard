"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/portal";
import type { Database } from "@/lib/supabase/database.types";

type DeliveryStatus = Database["public"]["Enums"]["delivery_status"];

export async function createDelivery(input: {
  titleId: string;
  vendorId: string;
  grantId: string;
  territory: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("create_delivery", {
    p_title_id: input.titleId,
    p_vendor_id: input.vendorId,
    p_grant_id: input.grantId,
    p_territory: input.territory,
  });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}

export async function setDeliveryStatus(
  deliveryId: string,
  status: DeliveryStatus,
  note?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("set_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: status,
    p_note: note && note.trim() ? note.trim() : undefined,
  });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}

// The raw token is shown to GC exactly once, in this return value — only the
// hash is ever persisted (create_portal_link stores p_token_hash). GC pastes
// the URL into their own outbound email; nothing here sends mail.
export async function createPortalLink(input: {
  deliveryId: string;
  assetId: string;
}): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const token = generateToken();
  const { error } = await supabase.rpc("create_portal_link", {
    p_delivery_id: input.deliveryId,
    p_asset_id: input.assetId,
    p_token_hash: hashToken(token),
  });
  if (error) return { error: error.message };
  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath("/gc/deliveries");
  return { url: `${base}/portal/${token}` };
}

export async function revokePortalLink(input: { linkId: string }): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("revoke_portal_link", { p_link_id: input.linkId });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}
