"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// Signup's org-creation step (§3: enters the 'registered' state). Goes through the
// SECURITY DEFINER RPC — the client never writes organizations/memberships directly.
export async function createOrg(name: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const orgName = name.trim();
  const { error } = await supabase.rpc("create_org_and_membership", { p_name: orgName });
  if (error) return { error: error.message };

  // Mirror the org name into user_metadata so Supabase's Auth → Users list reads
  // "Acme Films" instead of a bare UUID. Display convenience only: user_metadata is
  // user-writable, so no RLS policy or authorization path may ever read it — org
  // identity stays in memberships (spine §4). Org names are write-once (no rename
  // path exists), so the mirror cannot drift. A failure here is cosmetic and must
  // not strand a signup whose org already exists.
  const { error: nameError } = await supabase.auth.updateUser({
    data: { display_name: orgName },
  });
  if (nameError) console.error("[auth] display_name mirror failed", nameError.message);

  revalidatePath("/");
  redirect("/onboarding/plan"); // onboarding wizard: org created → choose plan
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
