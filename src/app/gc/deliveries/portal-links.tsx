"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createPortalLink, revokePortalLink } from "./actions";
import type { Database } from "@/lib/supabase/database.types";

type PortalEvent = Database["public"]["Enums"]["portal_event"];

const EVENT_LABELS: Record<PortalEvent, string> = {
  room_viewed: "Room viewed",
  otp_sent: "Code sent",
  otp_verified: "Verified",
  download: "Downloaded",
  restore_requested: "Restore started",
};

export type Master = { id: string; original_filename: string | null; bytes: number };
export type PortalLink = { id: string; asset_id: string; expires_at: string; revoked_at: string | null };
export type PortalAccessEvent = {
  link_id: string;
  event_type: PortalEvent;
  email: string | null;
  company: string | null;
  occurred_at: string;
};

const sel = "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

export function PortalLinks({
  deliveryId,
  masters,
  links,
  events,
}: {
  deliveryId: string;
  masters: Master[];
  links: PortalLink[];
  events: PortalAccessEvent[];
}) {
  const [assetId, setAssetId] = useState(masters[0]?.id ?? "");
  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!assetId) return;
    setBusy(true);
    setError(null);
    setGenerated(null);
    const res = await createPortalLink({ deliveryId, assetId });
    setBusy(false);
    if (res.error) return setError(res.error);
    setGenerated(res.url ?? null);
  }

  async function revoke(linkId: string) {
    setBusy(true);
    setError(null);
    const res = await revokePortalLink({ linkId });
    setBusy(false);
    if (res.error) setError(res.error);
  }

  const active = links.filter((l) => !l.revoked_at);
  const revoked = links.filter((l) => l.revoked_at);

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <span className="t-body-sm font-medium text-ink-2">Portal link</span>

      {masters.length === 0 ? (
        <p className="t-body-sm text-ink-3">No master asset uploaded for this title yet.</p>
      ) : (
        <div className="flex items-center gap-2">
          <select className={sel} value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={busy}>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>{m.original_filename ?? m.id}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={generate} disabled={busy || !assetId}>
            Generate link
          </Button>
        </div>
      )}

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
              <Button variant="ghost" onClick={() => revoke(l.id)} disabled={busy}>Revoke</Button>
            </div>
          ))}
        </div>
      ) : null}

      {revoked.length > 0 ? (
        <div className="flex flex-col gap-1">
          {revoked.map((l) => (
            <div key={l.id} className="t-body-sm text-ink-3">
              Revoked · was set to expire {new Date(l.expires_at).toLocaleDateString()}
            </div>
          ))}
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="flex flex-col gap-0.5 pt-1">
          <span className="t-label text-ink-3">Access log</span>
          {events.map((ev, i) => (
            <div key={i} className="t-body-sm text-ink-3">
              {EVENT_LABELS[ev.event_type]} · {ev.email ?? "—"}{ev.company ? ` (${ev.company})` : ""} ·{" "}
              {new Date(ev.occurred_at).toLocaleString()}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
