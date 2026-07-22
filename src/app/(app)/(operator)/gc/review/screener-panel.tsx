"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createScreenerLink, revokeScreenerLink } from "./actions";
import { ScreenerWatch } from "./screener-watch";

export type ScreenerLink = {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  share_token: string | null;
};
export type ScreenerViewer = {
  session_id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  watched_pct: number;
  completed: boolean;
  replays: number;
  last_viewed: string | null;
};

// GC-only "Screener" panel. Two distinct verbs: WATCH the screener in-app (no OTP, silent —
// see ScreenerWatch), and manage ONE reusable SHARE link to send to an outside viewer. The
// RPCs (create_screener_link, revoke_portal_link, screener_engagement) are the auth boundary —
// is_gc_staff enforced in the DB, not here. `activeShareUrl` is built server-side from the live
// link's persisted share_token (null until a link exists / for legacy hash-only links).
export function ScreenerPanel({
  titleId,
  links,
  engagement,
  activeShareUrl,
}: {
  titleId: string;
  links: ScreenerLink[];
  engagement: Record<string, ScreenerViewer[]>;
  activeShareUrl: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  // Create (or reset) the reusable share link: the RPC revokes any prior live link for this
  // title, so this is both "create" and "reset". Auto-copy the fresh URL — that's the point.
  async function createOrReset() {
    setBusy(true);
    setError(null);
    const res = await createScreenerLink({ titleId });
    setBusy(false);
    if (res.error) return setError(res.error);
    if (res.url) await copy(res.url);
    router.refresh();
  }

  async function revoke(linkId: string) {
    setBusy(true);
    setError(null);
    const res = await revokeScreenerLink({ linkId });
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  const active = links.filter((l) => !l.revoked_at);
  const shareLink = active.find((l) => l.share_token) ?? null;
  // Links from the pre-reusable model (no persisted token, can't be re-copied). They're all
  // revoked the next time a link is created/reset, so we just note the count — no row-per-link.
  const staleCount = active.length - (shareLink ? 1 : 0);
  const viewers = active.flatMap((l) => engagement[l.id] ?? []);

  return (
    <div className="flex flex-col gap-4 border-t border-hairline pt-3">
      {/* WATCH — GC staff view the screener in-app, no OTP, not logged as a screening. */}
      <div className="flex flex-col gap-1">
        <span className="t-body-sm font-medium text-ink-2">Screener</span>
        <ScreenerWatch titleId={titleId} />
      </div>

      {/* SHARE — one reusable link to send to an outside viewer. */}
      <div className="flex flex-col gap-2">
        <span className="t-label text-ink-3">Share with an outside viewer</span>

        {activeShareUrl ? (
          <>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-[var(--radius-sm)] bg-surface-muted px-2 py-1.5 t-body-sm text-ink-2">
                {activeShareUrl}
              </code>
              <Button variant="secondary" onClick={() => copy(activeShareUrl)} disabled={busy} className="shrink-0">
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <div className="flex items-center gap-3 t-body-sm text-ink-3">
              {shareLink ? <span>Expires {new Date(shareLink.expires_at).toLocaleDateString()}</span> : null}
              <button
                type="button"
                onClick={createOrReset}
                disabled={busy}
                className="text-ink-2 underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50"
              >
                Reset link
              </button>
              {shareLink ? (
                <button
                  type="button"
                  onClick={() => revoke(shareLink.id)}
                  disabled={busy}
                  className="text-ink-2 underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="t-body-sm text-ink-3">
                Anyone with the link confirms their name and email before they can watch.
              </p>
              <Button variant="secondary" onClick={createOrReset} disabled={busy} className="shrink-0">
                Create share link
              </Button>
            </div>
            {staleCount > 0 ? (
              <p className="t-body-sm text-ink-3">
                {staleCount} older link{staleCount === 1 ? "" : "s"} still active — creating a new one replaces
                {staleCount === 1 ? " it" : " them"}.
              </p>
            ) : null}
          </div>
        )}

        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      </div>

      {/* Who has watched — external viewers only (GC in-app previews are not logged). */}
      {viewers.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="t-label text-ink-3">Viewer activity</span>
          {viewers.map((v) => (
            <div key={v.session_id} className="flex items-center justify-between gap-3 t-body-sm text-ink-2">
              <span>
                {v.name ?? "—"}
                {v.company ? ` · ${v.company}` : ""}
                {v.email ? ` · ${v.email}` : ""}
              </span>
              <span className="shrink-0 text-ink-3">
                {v.watched_pct}% watched{v.completed ? " · completed" : ""}
                {v.replays > 0 ? ` · ${v.replays} replay${v.replays === 1 ? "" : "s"}` : ""}
                {v.last_viewed ? ` · ${new Date(v.last_viewed).toLocaleString()}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
