import "server-only";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Resolve title_id → signed poster URL for the latest `artwork` asset per title.
// Best-effort by design: reads are RLS-scoped (org isolation), and if CloudFront env is
// absent (e.g. local dev) or a title has no artwork, that title is simply omitted and the
// UI falls back to the monogram placeholder. Never throws — a poster is decoration, not data.
export async function titleArtworkUrls(
  supabase: ServerClient,
  titleIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (titleIds.length === 0) return map;

  const { data } = await supabase
    .from("assets")
    .select("title_id, storage_key, created_at")
    .eq("kind", "artwork")
    .in("title_id", titleIds)
    .order("created_at", { ascending: false });

  for (const a of data ?? []) {
    if (map.has(a.title_id)) continue; // query is desc → first seen is the latest
    try {
      map.set(a.title_id, signAssetUrl(a.storage_key));
    } catch {
      // CloudFront not configured (local) → leave unset → placeholder. Intentional.
    }
  }
  return map;
}
