"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { DELIVERY_STATUS_LABELS } from "@/lib/notifications";

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

  // §13/§20 push: notify the client on delivery transitions (says what changed).
  // Best-effort — the status change already committed.
  try {
    const { data: d } = await supabase
      .from("deliveries")
      .select("org_id, title_id, titles(title), vendors(name)")
      .eq("id", deliveryId)
      .maybeSingle();
    if (d) {
      await supabase.rpc("create_notification", {
        p_org_id: d.org_id,
        p_kind: "delivery_update",
        p_title: "Delivery update",
        p_body: `"${d.titles?.title ?? "Your title"}" is now ${DELIVERY_STATUS_LABELS[status]} on ${d.vendors?.name ?? "a platform"}`,
        p_source_refs: { delivery_id: deliveryId, title_id: d.title_id, status } as Json,
      });
    }
  } catch (e) {
    console.error("[notifications] delivery_update create failed", e);
  }

  revalidatePath("/gc/deliveries");
  return {};
}
