// Account photo object rules. Faces live in the dedicated private avatars
// bucket. Key is derived from the session user id; no SQL.

import { z } from "zod";

export const AVATAR_KEY_PREFIX = "avatars";
export const AVATAR_OBJECT_NAME = "avatar";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIGNED_URL_TTL_SECONDS = 300;

export const AVATAR_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

export const AVATAR_ACCEPT = AVATAR_CONTENT_TYPES.join(",");

const userIdSchema = z.string().uuid();

export function isAvatarContentType(value: string): value is AvatarContentType {
  return (AVATAR_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * `avatars/{user-id}/avatar` — the only legal face key.
 * Rejects anything that is not a UUID so a caller cannot write
 * a path-traversal key or a title-asset prefix.
 */
export function avatarObjectKey(userId: string): string {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) {
    throw new Error("Avatar key requires a UUID user id");
  }
  return `${AVATAR_KEY_PREFIX}/${parsed.data}/avatar`;
}

export function isAvatarObjectKey(key: string, userId: string): boolean {
  try {
    return key === avatarObjectKey(userId);
  } catch {
    return false;
  }
}
