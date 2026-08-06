import "server-only";

import { createClient } from "@/lib/supabase/server";
import { assetViewUrl } from "@/lib/asset-url";
import { PORTAL } from "@/lib/portal";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type TitleArtwork = { poster: string | null; banner: string | null };

// Resolve title_id → signed { poster, banner } URLs (the two "Artwork" graphics), latest
// of each kind per title. Best-effort by design: reads are RLS-scoped (org isolation), and
// if a URL cannot be produced or a graphic is missing, that slot is null and the UI shows
// the monogram placeholder. Never throws — a graphic is decoration, not data.
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

  // Pick the latest of each kind per title FIRST (the query is desc, so first seen wins),
  // then sign the winners together. Signing inside the loop would serialise it.
  const wanted: { titleId: string; slot: "poster" | "banner"; key: string }[] = [];
  for (const a of data ?? []) {
    const slot = a.kind === "banner" ? "banner" : "poster";
    const entry = map.get(a.title_id) ?? { poster: null, banner: null };
    map.set(a.title_id, entry);
    if (wanted.some((w) => w.titleId === a.title_id && w.slot === slot)) continue;
    wanted.push({ titleId: a.title_id, slot, key: a.storage_key });
  }

  const signed = await Promise.all(
    wanted.map(async (w) => {
      try {
        // stableWindow: identical URL for the whole hour, so the browser caches the
        // image instead of re-downloading 2.5-3 MB on every navigation.
        return {
          ...w,
          url: await assetViewUrl(w.key, PORTAL.artworkTtlSeconds, { stableWindow: true }),
        };
      } catch {
        return { ...w, url: null }; // unservable → placeholder. Intentional.
      }
    }),
  );

  for (const s of signed) {
    const entry = map.get(s.titleId);
    if (entry) entry[s.slot] = s.url;
  }
  return map;
}
