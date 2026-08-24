"use server";

import { revalidatePath } from "next/cache";

import { ACCOUNT_PROFILE, COMPANY_PROFILE, canEditCompanyProfile } from "@/lib/account-profile";
import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

// Display name only. Email is auth.users — changing the login email is an
// auth gate and is not done here. user_metadata.display_name already exists
// (createOrg mirrors the org name into it).
export async function saveAccountName(name: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  if (!ctx) return { error: ACCOUNT_PROFILE.signedOut };

  const { error } = await supabase.auth.updateUser({
    data: { display_name: name.trim() },
  });
  if (error) return { error: error.message || ACCOUNT_PROFILE.saveFailed };

  revalidatePath("/account");
  revalidatePath("/");
  return {};
}

// organizations.name — existing column, existing organizations_update RLS
// (manage_settings = account_owner, plus GC staff bypass). Name only.
export async function saveCompanyName(name: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  if (!ctx) return { error: COMPANY_PROFILE.signedOut };
  if (!ctx.activeOrg) return { error: COMPANY_PROFILE.saveFailed };
  if (!canEditCompanyProfile(ctx.activeRole, ctx.isGcStaff)) {
    return { error: COMPANY_PROFILE.forbidden };
  }

  const trimmed = name.trim();
  if (!trimmed) return { error: COMPANY_PROFILE.nameRequired };

  const { data, error } = await supabase
    .from("organizations")
    .update({ name: trimmed })
    .eq("id", ctx.activeOrg.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message || COMPANY_PROFILE.saveFailed };
  if (!data) return { error: COMPANY_PROFILE.forbidden };

  revalidatePath("/account/company");
  revalidatePath("/");
  return {};
}
