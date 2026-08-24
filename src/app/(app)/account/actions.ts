"use server";

import { revalidatePath } from "next/cache";

import {
  ACCOUNT_PROFILE,
  COMPANY_PROFILE,
  accountNameSchema,
  companySaveSchema,
} from "@/lib/account-profile";
import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

// Display name only. Email is auth.users — changing the login email is an
// auth gate and is not done here. user_metadata.display_name already exists
// (createOrg mirrors the org name into it).
export async function saveAccountName(name: unknown): Promise<{ error?: string }> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  if (!ctx) return { error: ACCOUNT_PROFILE.signedOut };

  const parsed = accountNameSchema.safeParse(name);
  if (!parsed.success) return { error: ACCOUNT_PROFILE.invalidName };

  const { error } = await supabase.auth.updateUser({
    data: { display_name: parsed.data },
  });
  if (error) return { error: error.message || ACCOUNT_PROFILE.saveFailed };

  // updateUser persists user_metadata but does not mint a new access token.
  // Identity is read from JWT claims, so refresh the session cookie now.
  await supabase.auth.refreshSession();

  revalidatePath("/account");
  revalidatePath("/");
  return {};
}

// organizations.name — existing column, existing organizations_update RLS
// (member_can manage_settings). Bind the write to the org the form rendered,
// not whichever cookie is active at submit.
export async function saveCompanyName(input: unknown): Promise<{ error?: string }> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  if (!ctx) return { error: COMPANY_PROFILE.signedOut };

  const parsed = companySaveSchema.safeParse(input);
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((issue) => issue.path[0] === "name");
    return {
      error:
        nameIssue?.code === "too_small" ? COMPANY_PROFILE.nameRequired : COMPANY_PROFILE.invalidName,
    };
  }

  const { data: canManage, error: canError } = await supabase.rpc("member_can", {
    p_uid: ctx.user.id,
    p_org: parsed.data.orgId,
    p_capability: "manage_settings",
  });
  if (canError || canManage !== true) return { error: COMPANY_PROFILE.forbidden };

  const { data, error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.orgId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message || COMPANY_PROFILE.saveFailed };
  if (!data) return { error: COMPANY_PROFILE.forbidden };

  revalidatePath("/account/company");
  revalidatePath("/");
  return {};
}
