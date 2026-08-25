"use server";

import { revalidatePath } from "next/cache";

import {
  ACCOUNT_PROFILE,
  COMPANY_PROFILE,
  accountNameSchema,
  companySaveSchema,
} from "@/lib/account-profile";
import { AVATAR_MAX_BYTES, isAvatarContentType } from "@/lib/account-avatar";
import { putAvatarObject } from "@/lib/s3-avatars";
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

  // updateUser writes user_metadata but leaves the access-token JWT as a
  // snapshot. getAuthUser reads display_name from getClaims(), so
  // /settings/profile and the account-sheet Identity stay empty until
  // this refresh.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return { error: refreshError.message || ACCOUNT_PROFILE.saveFailed };

  revalidatePath("/settings");
  revalidatePath("/settings/profile");
  revalidatePath("/");
  return {};
}

// Photo bytes go to the dedicated avatars bucket, key derived from the
// session user id. Email is not touched. No SQL.
export async function uploadAccountPhoto(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getOrgContext();
  if (!ctx) return { error: ACCOUNT_PROFILE.signedOut };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: ACCOUNT_PROFILE.photoMissing };
  }
  if (!isAvatarContentType(file.type)) return { error: ACCOUNT_PROFILE.photoType };
  if (file.size > AVATAR_MAX_BYTES) return { error: ACCOUNT_PROFILE.photoTooLarge };

  try {
    const body = new Uint8Array(await file.arrayBuffer());
    await putAvatarObject(ctx.user.id, body, file.type);
  } catch (e) {
    return { error: e instanceof Error && e.message ? e.message : ACCOUNT_PROFILE.photoFailed };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/profile");
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

  revalidatePath("/settings");
  revalidatePath("/settings/profile");
  revalidatePath("/");
  return {};
}
