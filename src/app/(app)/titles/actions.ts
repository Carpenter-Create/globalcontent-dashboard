"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// Create a title stub (§12) for the active org. Goes through the create_title
// SECURITY DEFINER RPC — the client never writes the titles table directly, and
// the RPC re-checks member_can(..., 'operate') server-side (defense in depth).
// The client sets release_type (+ original release date for a re-release); the
// forward-looking release_date is GC-owned and never set here.
export async function createTitle(
  orgId: string,
  title: string,
  releaseType: "new_release" | "re_release",
  originalReleaseDate?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("create_title", {
    p_org_id: orgId,
    p_title: title,
    p_release_type: releaseType,
    // Omitted for a new release; the RPC requires it only for a re-release.
    p_original_release_date: originalReleaseDate,
  });
  if (error) return { error: error.message };

  revalidatePath("/titles");
  return {};
}
