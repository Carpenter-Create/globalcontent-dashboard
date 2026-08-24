// /settings#profile and /account/company copy + identity helpers. Copy
// lives here, not in JSX. Name is user_metadata.display_name (already
// written at org create). Email is auth.users — shown, not changed.
// Company name is organizations.name. Company stays off /settings.

import { z } from "zod";

import { USER_MENU, userMenuName } from "@/lib/user-menu";

// Settings section title is Profile. The Identity menu label is Profile.
// Do not merge Company onto /settings.

/** Conservative bound — same ceiling as other person/company name writes. */
export const ACCOUNT_NAME_MAX = 200;

// House t-body is 15px. iOS Safari zooms the page when a focused input is
// under 16px. Lock only these account fields — do not restyle dashboard inputs.
export const ACCOUNT_FIELD_CLASS = "!text-[16px]";

// Figma 558:639 / 554:637 — empty 48 circle until a real photo exists.
// Do not put an initial in this well (that invents a face).
export const ACCOUNT_PHOTO_CIRCLE_CLASS =
  "size-12 shrink-0 overflow-hidden rounded-full bg-surface-muted";

export const ACCOUNT_PROFILE = {
  title: "Profile",
  href: USER_MENU.profileHref,
  nameLabel: "Name",
  emailLabel: "Email",
  emailHint: "Sign-in email. It cannot be changed here.",
  uploadPhoto: "Upload photo",
  uploadingPhoto: "Uploading…",
  photoAlt: "Account photo",
  photoMissing: "Choose a photo to upload.",
  photoTooLarge: "Photo must be 2 MB or smaller.",
  photoType: "Use a JPEG, PNG, or WebP photo.",
  photoFailed: "Could not upload photo.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  signedOut: "Not authenticated.",
  saveFailed: "Could not save.",
  invalidName: "Name must be 200 characters or fewer.",
} as const;

export const COMPANY_PROFILE = {
  title: "Company Profile",
  href: "/account/company",
  subtitle: "Name of the organization on this account.",
  nameLabel: "Company name",
  nameRequired: "Company name is required.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  signedOut: "Not authenticated.",
  forbidden: "Only the account owner can change the company name.",
  saveFailed: "Could not save.",
  invalidName: "Company name must be 200 characters or fewer.",
} as const;

export const accountNameSchema = z
  .string()
  .max(ACCOUNT_NAME_MAX)
  .transform((value) => value.trim())
  .pipe(z.string().max(ACCOUNT_NAME_MAX));

export const companySaveSchema = z.object({
  orgId: z.string().uuid(),
  name: z
    .string()
    .max(ACCOUNT_NAME_MAX)
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(ACCOUNT_NAME_MAX)),
});

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
