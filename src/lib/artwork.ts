import "server-only";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type TitleArtwork = { poster: string | null; banner: string | null };

// Resolve title_id → signed { poster, banner } URLs (the two "Artwork" graphics), latest
// of each kind per title. Best-effort by design: reads are RLS-scoped (org isolation), and
// if CloudFront env is absent (e.g. local dev) or a graphic is missing, that slot is null and
// the UI shows the monogram placeholder. Never throws — a graphic is decoration, not data.
export async function titleArtworkUrls(
  supabase: ServerClient,
  titleIds: string[],
): Promise<Map<string, TitleArtwork>> {
  const map = new Map<string, TitleArtwork>();
  if (titleIds.length === 0) return map;

  const { data } = await supabase
    .from("assets")
    .select("title_id, kind, storage_key, created_at")
    .in("kind", ["poster", "banner"])
    .in("title_id", titleIds)
    .order("created_at", { ascending: false });

  for (const a of data ?? []) {
    const slot = a.kind === "banner" ? "banner" : "poster";
    const entry = map.get(a.title_id) ?? { poster: null, banner: null };
    if (entry[slot]) continue; // query is desc → first seen of each kind is the latest
    try {
      entry[slot] = signAssetUrl(a.storage_key);
    } catch {
      // CloudFront not configured (local) → leave null → placeholder. Intentional.
    }
    map.set(a.title_id, entry);
  }
  return map;
}
