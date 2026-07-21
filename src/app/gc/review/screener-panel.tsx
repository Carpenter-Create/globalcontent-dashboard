"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createScreenerLink, revokeScreenerLink } from "./actions";

export type ScreenerLink = { id: string; expires_at: string; revoked_at: string | null; created_at: string };
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

// GC-only "Screen this title" panel: generate/revoke screener links and the
// per-viewer watch summary. The RPCs (create_screener_link, revoke_portal_link,
// screener_engagement) are the auth boundary — is_gc_staff enforced in the DB, not here.
export function ScreenerPanel({
  titleId,
  links,
  engagement,
}: {
  titleId: string;
  links: ScreenerLink[];
  engagement: Record<string, ScreenerViewer[]>;
}) {
  const router = useRouter();
  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setGenerated(null);
    const res = await createScreenerLink({ titleId });
    setBusy(false);
    if (res.error) return setError(res.error);
    setGenerated(res.url ?? null);
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
  const revoked = links.filter((l) => l.revoked_at);
  const viewers = active.flatMap((l) => engagement[l.id] ?? []);

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="t-body-sm font-medium text-ink-2">Screen this title</span>
        <Button variant="secondary" onClick={generate} disabled={busy} className="shrink-0">
          Generate link
        </Button>
      </div>

      {generated ? (
        <InlineNotice tone="info">
          Copy into your email — shown once, not stored: <code className="break-all">{generated}</code>
        </InlineNotice>
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      {active.length > 0 ? (
        <div className="flex flex-col gap-1">
          {active.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 t-body-sm text-ink-2">
              <span>Active · expires {new Date(l.expires_at).toLocaleDateString()}</span>
              <Button variant="ghost" onClick={() => revoke(l.id)} disabled={busy}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="t-body-sm text-ink-3">No active screener links.</p>
      )}

      {revoked.length > 0 ? (
        <div className="flex flex-col gap-1">
          {revoked.map((l) => (
            <div key={l.id} className="t-body-sm text-ink-3">
              Revoked · was set to expire {new Date(l.expires_at).toLocaleDateString()}
            </div>
          ))}
        </div>
      ) : null}

      {viewers.length > 0 ? (
        <div className="flex flex-col gap-0.5 pt-1">
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
