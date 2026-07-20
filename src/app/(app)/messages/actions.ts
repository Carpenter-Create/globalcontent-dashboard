"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Mark the given notifications read for the current user (per-user read state).
export async function markAllRead(ids: string[]): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  if (error) return { error: error.message };

  revalidatePath("/messages");
  return {};
}
