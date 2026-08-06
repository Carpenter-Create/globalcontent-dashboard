"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createBuyerScreenerLink, revokeBuyerScreenerLink } from "./actions";

// The client's own screener share link — one reusable URL per title to send a prospective
// buyer. Distinct from the in-app player above it: that stream expires in two hours and is
// scoped to the signed-in user, so it cannot be forwarded to anyone.
//
// Authorization lives in create_screener_link (operate on the title's org + post-approval
// status), not here. This component only renders for callers the page already established
// can operate, which keeps the control off read-only seats — but the DB is the boundary.
export function BuyerShareControl({
  titleId,
  activeUrl,
  activeLinkId,
  expiresAt,
}: {
  titleId: string;
  activeUrl: string | null;
  activeLinkId: string | null;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(activeUrl);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    const res = await createBuyerScreenerLink({ titleId });
    setBusy(false);
    if (res.error) return setError(res.error);
    setUrl(res.url ?? null);
    router.refresh();
  }

  async function revoke() {
    if (!activeLinkId) return;
    setBusy(true);
    setError("");
    const res = await revokeBuyerScreenerLink({ linkId: activeLinkId, titleId });
    setBusy(false);
    if (res.error) return setError(res.error);
    setUrl(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="t-label text-ink-2">Share with a buyer</p>

      {url ? (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              aria-label="Screener share link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink-2"
            />
            <Button type="button" onClick={() => copy(url)} className="shrink-0">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="t-body-sm text-ink-3">
            The recipient enters their email and a code we send them before the screener plays. It cannot be
            downloaded.
            {expiresAt ? ` This link expires ${new Date(expiresAt).toLocaleDateString()}.` : null}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="t-body-sm text-ink-2 underline underline-offset-4 hover:text-ink disabled:opacity-50"
            >
              Replace link
            </button>
            <span className="text-ink-3">·</span>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="t-body-sm text-ink-2 underline underline-offset-4 hover:text-ink disabled:opacity-50"
            >
              Stop sharing
            </button>
          </div>
          <p className="t-body-sm text-ink-3">
            Replacing sends a new URL and stops the old one working. Stopping ends access entirely.
          </p>
        </>
      ) : (
        <>
          <Button type="button" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create share link"}
          </Button>
          <p className="t-body-sm text-ink-3">
            One reusable link. The buyer enters their email and a code we send them before the screener plays; you
            can stop it at any time.
          </p>
        </>
      )}

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
