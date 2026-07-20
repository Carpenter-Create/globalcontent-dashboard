"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
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
