"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createBuyerScreenerLink, revokeBuyerScreenerLink } from "./actions";

export type BuyerLink = {
  linkId: string;
  // Nullable, not a placeholder string: GC mints a screener link during chain-of-title review
  // with no recipient at all (gc/review/actions.ts createScreenerLink), and since 20260806000300
  // removed the author partition, that row is now visible here too. Keeping the real `null`
  // through to this component (rather than coercing to a label upstream) is what lets the
  // "Replace link" action be gated on an actual type check instead of a string comparison
  // against whatever placeholder text is on screen — see the guard below.
  recipientName: string | null;
  url: string;
  expiresAt: string | null;
};

// Every screener share link on this title, this org's own and GC's outbound activity alike
// (20260806000300 removed the partition that used to hide GC's rows from the client — this is
// the client's revenue and their title, so GC's outbound activity is not withheld). Distinct
// from the in-app player above it: that stream expires in two hours and is scoped to the
// signed-in user, so it cannot be forwarded to anyone.
//
// Links are per-buyer, not per-title (Task 4): a title with three prospects in flight shows
// three rows. Authorization and the recipient-name matching both live in the DB —
// create_screener_link revokes-then-creates by (title, recipient_name) case-insensitively, and
// revoke_portal_link is capability-checked there too — so this component only renders the rows
// the page already resolved and never re-derives who may act on them.
export function BuyerShareControl({ titleId, links }: { titleId: string; links: BuyerLink[] }) {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copy(linkId: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(linkId);
      setTimeout(() => setCopiedId((cur) => (cur === linkId ? null : cur)), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  // `replace: true` is the deliberate, informed path from an existing row's "Replace link" —
  // it skips the collision check server-side (see actions.ts) since the caller already knows
  // exactly which buyer they're replacing. The create form below never passes it, so a
  // colliding name there surfaces the warning instead of silently swapping the old link out.
  async function create(recipientName: string, opts?: { replace?: boolean }) {
    setBusy(true);
    setError("");
    const res = await createBuyerScreenerLink({ titleId, recipientName, replace: opts?.replace });
    setBusy(false);
    if (res.error) return setError(res.error);
    setRecipient("");
    router.refresh();
  }

  async function revoke(linkId: string) {
    setBusy(true);
    setError("");
    const res = await revokeBuyerScreenerLink({ linkId, titleId });
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="t-label text-ink-2">Share with a buyer</p>

      {links.length > 0 ? (
        <div className="flex flex-col gap-3">
          {links.map((link) => {
            // Narrow once per row: `recipientName` typed `string | null` (not a placeholder
            // string) is what makes this a real type guard rather than a comparison against
            // whatever label text happens to be on screen. A null recipient means GC minted
            // this during chain-of-title review with no buyer attached — "replace the link for
            // no particular buyer" isn't a coherent action, so there is nothing to gate it
            // against; the row gets Copy and Stop sharing only.
            const recipientName = link.recipientName;
            const displayName = recipientName ?? "Shared by Global Content";
            return (
              <div key={link.linkId} className="rounded-[var(--radius-sm)] border border-hairline p-3">
                <p className="t-body-sm font-medium text-ink">{displayName}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    readOnly
                    value={link.url}
                    aria-label={`Screener share link for ${displayName}`}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink-2"
                  />
                  <Button type="button" onClick={() => copy(link.linkId, link.url)} className="shrink-0">
                    {copiedId === link.linkId ? "Copied" : "Copy"}
                  </Button>
                </div>
                {link.expiresAt ? (
                  <p className="mt-1 t-body-sm text-ink-3">
                    Expires {new Date(link.expiresAt).toLocaleDateString()}.
                  </p>
                ) : null}
                <div className="mt-1.5 flex items-center gap-2">
                  {recipientName !== null ? (
                    <>
                      <button
                        type="button"
                        onClick={() => create(recipientName, { replace: true })}
                        disabled={busy}
                        className="t-body-sm text-ink-2 underline underline-offset-4 hover:text-ink disabled:opacity-50"
                      >
                        Replace link
                      </button>
                      <span className="text-ink-3">·</span>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => revoke(link.linkId)}
                    disabled={busy}
                    className="t-body-sm text-ink-2 underline underline-offset-4 hover:text-ink disabled:opacity-50"
                  >
                    Stop sharing
                  </button>
                </div>
              </div>
            );
          })}
          <p className="t-body-sm text-ink-3">
            Replacing a link sends a new URL and stops the old one working. Stopping ends access entirely.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (recipient.trim()) create(recipient);
        }}
        className="flex flex-col gap-1.5"
      >
        <Label htmlFor="buyer-name">Buyer</Label>
        <div className="flex items-center gap-2">
          <Input
            id="buyer-name"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Buyer's name"
            className="max-w-xs"
          />
          <Button type="submit" disabled={busy || !recipient.trim()} className="shrink-0">
            {busy ? "Creating…" : "Create share link"}
          </Button>
        </div>
        <p className="t-body-sm text-ink-3">
          One link per buyer. Naming them lets you see who watched, and releases the master to
          them once their licence is live.
        </p>
      </form>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
