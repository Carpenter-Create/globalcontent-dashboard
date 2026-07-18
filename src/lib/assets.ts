import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const PART_SIZE = 64 * 1024 * 1024; // 64 MiB

// Server-derived S3 key. crypto.randomUUID() namespaces each upload so re-uploads
// never collide. The filename tail is cosmetic; authz never trusts the key.
export function assetKey(
  orgId: string,
  titleId: string,
  kind: string,
  filename: string,
): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "file";
  return `orgs/${orgId}/titles/${titleId}/${kind}/${crypto.randomUUID()}/${safe}`;
}

// Authz for the route handlers: confirm the title is visible to the caller (RLS)
// AND the caller has 'operate' in that title's org. Returns the org id or null.
// (create_asset re-checks at the DB layer; this pre-check avoids presigning for
// someone who can't operate.)
export async function resolveOperableTitle(
  supabase: SupabaseClient<Database>,
  titleId: string,
): Promise<{ orgId: string } | null> {
  const { data: title } = await supabase
    .from("titles")
    .select("org_id")
    .eq("id", titleId)
    .maybeSingle();
  if (!title) return null; // RLS hides other orgs' titles

  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", title.org_id)
    .eq("status", "active")
    .maybeSingle();
  const canOperate = m?.role === "account_owner" || m?.role === "delivery_ops";
  return canOperate ? { orgId: title.org_id } : null;
}
