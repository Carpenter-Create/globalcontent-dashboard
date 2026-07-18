"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Create a title stub (§12) for the active org. Goes through the create_title
// SECURITY DEFINER RPC — the client never writes the titles table directly, and
// the RPC re-checks member_can(..., 'operate') server-side (defense in depth).
export async function createTitle(orgId: string, title: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("create_title", { p_org_id: orgId, p_title: title });
  if (error) return { error: error.message };

  revalidatePath("/titles");
  return {};
}
