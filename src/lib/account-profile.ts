// /account and /account/company copy + identity helpers. Copy lives here,
// not in JSX. Name is user_metadata.display_name (already written at org
// create). Email is auth.users — shown, not changed. Company name is
// organizations.name.

import { userMenuName } from "@/lib/user-menu";

export const ACCOUNT_PROFILE = {
  title: "User Profile",
  subtitle: "Name and email on this account.",
  nameLabel: "Name",
  emailLabel: "Email",
  emailHint: "Sign-in email. It cannot be changed here.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  signedOut: "Not authenticated.",
  saveFailed: "Could not save.",
} as const;

export const COMPANY_PROFILE = {
  title: "Company Profile",
  subtitle: "Name of the organization on this account.",
  nameLabel: "Company name",
  nameRequired: "Company name is required.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  signedOut: "Not authenticated.",
  forbidden: "Only the account owner can change the company name.",
  saveFailed: "Could not save.",
  href: "/account/company",
} as const;

export function canEditCompanyProfile(
  role: string | null | undefined,
  isGcStaff: boolean,
): boolean {
  return isGcStaff || role === "account_owner";
}

/**
 * Display name already stored on the session JWT. Empty stays empty.
 * Never derive a name from an email local-part.
 */
export function authDisplayName(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const record = claims as Record<string, unknown>;
  const meta = record.user_metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).display_name;
  return userMenuName(typeof value === "string" ? value : null);
}
