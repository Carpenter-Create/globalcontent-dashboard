// Real person-name from JWT claims only. Never invent a name from the
// email local-part. Never treat user_metadata.display_name as a person
// name — createOrg mirrors the org name there for the Auth admin list.

export type AuthNameClaims = {
  name?: unknown;
  email?: unknown;
  user_metadata?: unknown;
};

function asPersonName(value: unknown, email: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === email) return null;
  return trimmed;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A real display name already on the session, or null. */
export function resolveAuthUserName(claims: AuthNameClaims): string | null {
  const email = typeof claims.email === "string" ? claims.email : "";
  const fromClaim = asPersonName(claims.name, email);
  if (fromClaim) return fromClaim;

  const meta = metadataRecord(claims.user_metadata);
  if (!meta) return null;
  return asPersonName(meta.full_name, email) ?? asPersonName(meta.name, email);
}
