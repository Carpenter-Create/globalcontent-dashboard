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

  const { error } = await supabase.rpc("create_org_and_membership", { p_name: name });
  if (error) return { error: error.message };

  revalidatePath("/");
  redirect("/onboarding/plan"); // onboarding wizard: org created → choose plan
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
