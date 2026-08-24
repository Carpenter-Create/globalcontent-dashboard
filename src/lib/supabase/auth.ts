import "server-only";
import { cache } from "react";

import { authDisplayName } from "@/lib/account-profile";

import { createClient } from "./server";

export type AuthUser = {
  id: string;
  email: string;
  /** user_metadata.display_name when present. Never invented from email. */
  name?: string | null;
};

// Request-scoped authenticated identity.
//
// TWO things make this cheap where `supabase.auth.getUser()` was not:
//
// 1. `getClaims()` verifies the JWT LOCALLY (WebCrypto + a cached JWKS) when the project
//    uses asymmetric signing keys — ES256 here. `getUser()` is a network round-trip to the
//    Auth server on EVERY call; measured at 35–49ms against a local Supabase, and worse
//    against a hosted one. `getClaims()` still calls getSession() internally, so an expired
//    token is refreshed exactly as before. On a symmetric-key project it transparently falls
//    back to getUser(), so this is safe regardless of key config.
//
// 2. React `cache()` dedupes within a single render pass. A layout and the page beneath it
//    both calling getAuthUser() cost ONE verification, not two.
//
// Returns id + email + the existing display_name on the JWT when present.
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    name: authDisplayName(data.claims),
  };
});
