import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL, PORTAL_COPY } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";

export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  // The RPC raises when the SESSION itself (not the buyer-link gate below) is gone — expired,
  // revoked, or the link it points at is expired/revoked. Distinct copy from the buyer-link
  // gate's 403 below: ScreenerRoom reads this route's error body to tell "your access lapsed
  // mid-visit" (this branch) apart from "no viewable screener has been provided" (the gate) —
  // conflating them told a buyer whose session simply expired that the screener itself "isn't
  // available yet," which is false and not what happened.
  if (error || !row) return NextResponse.json({ error: PORTAL_COPY.errorExpired }, { status: 403 });

  // Buyer-link gate — THE authorization for this route (buyer-page.ts's canWatchScreener
  // mirrors it so the UI doesn't offer the refused action, but that copy is not this check;
  // this one is what actually stops the bytes). portal_resolve_screener above already
  // resolved storage_key from the title's CURRENT screener_source, but it deliberately
  // doesn't distinguish WHO the link is for (it also backs GC's own in-room reviewer flow,
  // which must keep working on any status/source). recipient_name is that discriminator:
  // non-null exactly for a client-minted buyer link (create_screener_link,
  // 20260806000200/...300), null for GC's own operational link. On the 'master' default "the
  // screener" IS the master byte-for-byte (screenerKindFor's comment, lib/assets.ts) — a
  // <video> stream and a one-click download differ only in how many clicks it takes to walk
  // off with an unwatermarked deliverable, so a buyer link gets the same refusal the download
  // route already enforces. GC's own operational link is deliberately left unchanged: that
  // risk predates this branch and is GC's own workflow to carry, not something to break today
  // as collateral damage. Re-read fresh from the DB, never inferred from the page that
  // rendered the Watch button — CLAUDE.md rule 10, never trust the client for this.
  const [
    { data: linkRow, error: linkError },
    { data: titleRow, error: titleError },
  ] = await Promise.all([
    admin.from("portal_links").select("recipient_name").eq("id", row.link_id).maybeSingle(),
    admin.from("titles").select("screener_source").eq("id", row.title_id).maybeSingle(),
  ]);
  // Fail closed on an unreadable row — a transient read error must never widen the gate.
  // The unknown case is the closed case for EACH flag independently: an unreadable link is
  // treated as a buyer link (not GC's own), and an unreadable title is treated as NOT a
  // dedicated screener. Both defaults only ever tighten the check below, never bypass it —
  // the opposite of the bug this replaces, where `linkRow` being null on a failed read made
  // `isBuyerLink` false and skipped the gate outright, streaming a buyer link's master.
  const isBuyerLink = linkError ? true : Boolean(linkRow?.recipient_name);
  const screenerIsDedicated = titleError ? false : titleRow?.screener_source === "dedicated";
  if (isBuyerLink && !screenerIsDedicated) {
    return NextResponse.json({ error: PORTAL_COPY.screenerStreamUnavailableNotice }, { status: 403 });
  }

  // Glacier gate: a master-source screener may be in cold storage. resolveOrRestore HEADs the
  // object and auto-initiates a Standard restore on first hit; "restoring" → 409 "preparing".
  // (Dedicated screeners live on S3 Standard and resolve to "available" immediately.)
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      // best-effort provenance — a log failure (error OR thrown) must NOT turn "preparing"
      // into an error; the restore has already been initiated.
      try {
        await admin.from("portal_access_events").insert({
          link_id: row.link_id,
          session_id: row.session_id,
          event_type: "restore_requested",
          user_agent: req.headers.get("user-agent") ?? null,
        });
      } catch {
        /* swallow — provenance is best-effort here */
      }
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  let url: string;
  // Long TTL: range-based <video> playback re-validates the signed URL on every byte-range
  // request across the whole runtime, so a short (download-style) TTL would 403 mid-film.
  try { url = await assetViewUrl(row.storage_key, PORTAL.screenerStreamTtlSeconds); }
  catch { return NextResponse.json({ error: "File is being prepared" }, { status: 409 }); }
  return NextResponse.json({ type: "progressive", url });
}
