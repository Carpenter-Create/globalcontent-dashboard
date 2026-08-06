"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { attachLinkVendor } from "./actions";

export type BuyerLink = {
  id: string;
  recipientName: string;
  createdAt: string;
  vendorId: string | null;
  vendorName: string | null;
};
export type VendorOption = { id: string; name: string };

const sel =
  "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

// GC attaches the vendor once a buyer's deal closes. Clients cannot pick one themselves —
// vendors is a GC-only roster (exposing it to every client would reveal GC's whole
// distribution network) — so a buyer's link sits with vendor_id null until GC does this, and
// the master stays unreachable through it until then (attach_link_vendor, 20260806000400).
// Only NAMED, ACTIVE screener_view links land here — the page filters out GC's own ambient
// share link (recipient_name null, managed by ScreenerPanel above) and anything revoked or
// expired, since attaching a vendor to a dead link is refused by the RPC anyway.
//
// Reassigning a link that already carries a DIFFERENT vendor is a deliberate, explicit second
// step, mirroring "Replace link" on the client's own share control (buyer-share-control.tsx) —
// never a silent swap from picking a new option in the select.
export function BuyerLinks({
  titleId,
  links,
  vendors,
}: {
  titleId: string;
  links: BuyerLink[];
  vendors: VendorOption[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attach(link: BuyerLink, force: boolean) {
    const vendorId = choice[link.id];
    if (!vendorId) return;
    setBusyId(link.id);
    setError(null);
    const res = await attachLinkVendor({ titleId, linkId: link.id, vendorId, force });
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  function onAttachClick(link: BuyerLink) {
    const vendorId = choice[link.id];
    if (!vendorId) return;
    if (link.vendorId && link.vendorId !== vendorId) {
      setConfirming(link.id); // reassignment needs the explicit step below, not a silent swap
      return;
    }
    void attach(link, false);
  }

  if (links.length === 0) {
    return <p className="t-body-sm text-ink-3">No active buyer links for this title.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => {
        const pendingVendorName = vendors.find((v) => v.id === choice[link.id])?.name;
        return (
          <div key={link.id} className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-hairline p-3">
            <div className="flex items-center justify-between gap-4">
              <span className="t-body-sm font-medium text-ink">{link.recipientName}</span>
              <span className="shrink-0 t-body-sm text-ink-3">
                Shared {new Date(link.createdAt).toLocaleDateString()}
              </span>
            </div>
            <span className="t-body-sm text-ink-3">
              {link.vendorName ? `Attached to ${link.vendorName}` : "No vendor attached — the master isn't reachable through this link yet"}
            </span>
            <div className="flex items-center gap-2 pt-1">
              <select
                className={sel}
                value={choice[link.id] ?? ""}
                onChange={(e) => {
                  setChoice((c) => ({ ...c, [link.id]: e.target.value }));
                  setConfirming(null);
                }}
                disabled={busyId === link.id}
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                onClick={() => onAttachClick(link)}
                disabled={busyId === link.id || !choice[link.id] || choice[link.id] === link.vendorId}
              >
                Attach
              </Button>
            </div>
            {confirming === link.id ? (
              <InlineNotice tone="info" className="flex flex-wrap items-center gap-2">
                <span>
                  Already attached to {link.vendorName}. Reassigning moves this buyer&apos;s master
                  access to {pendingVendorName ?? "the new vendor"}.
                </span>
                <Button variant="secondary" onClick={() => attach(link, true)} disabled={busyId === link.id}>
                  Reassign
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busyId === link.id}>
                  Cancel
                </Button>
              </InlineNotice>
            ) : null}
          </div>
        );
      })}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
