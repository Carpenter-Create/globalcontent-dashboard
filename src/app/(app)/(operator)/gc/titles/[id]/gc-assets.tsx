"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

export type GcAsset = {
  id: string;
  kind: string;
  original_filename: string | null;
  bytes: number;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// GC internal viewer: view/download any asset directly (opens a signed CloudFront URL in a
// new tab — the browser plays video inline or downloads other types). No OTP; is_gc_staff
// enforced by /api/gc/asset-url.
export function GcAssets({ assets }: { assets: GcAsset[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function open(id: string) {
    setBusyId(id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/gc/asset-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: id }),
      });
      if (res.status === 202) {
        setNote("Preparing this file from cold storage (~3–5h). Try again once it's restored.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not open the file.");
        return;
      }
      window.open(data.url, "_blank", "noopener");
    } finally {
      setBusyId(null);
    }
  }

  if (assets.length === 0) return <p className="t-body-sm text-ink-3">No assets uploaded yet.</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {assets.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 t-body-sm">
          <span className="text-ink-2">
            <span className="t-label text-ink-3">{a.kind}</span> · {a.original_filename ?? "file"} ·{" "}
            {fmtBytes(a.bytes)}
          </span>
          <Button
            variant="secondary"
            onClick={() => open(a.id)}
            disabled={busyId === a.id}
            className="shrink-0"
          >
            {busyId === a.id ? "Opening…" : "View / download"}
          </Button>
        </div>
      ))}
      {note ? <InlineNotice tone="info">{note}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
