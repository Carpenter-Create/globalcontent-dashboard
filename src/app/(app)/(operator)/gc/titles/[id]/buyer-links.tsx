"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { attachLinkVendor } from "./actions";

export type BuyerLink = {
  id: string;
  recipientName: string;
  createdAt: string;
  vendorId: string | null;
  vendorName: string | null;
};
export type VendorOption = {
  id: string;
  name: string;
  // Would attaching THIS vendor to a still-vendor-less link release the master immediately —
  // an active grant + delivery for (title, vendor) already exists. Rendering hint only; the
  // RPC (title_vendor_licensed) re-derives this itself and is the actual authorization.
  releasesMasterNow: boolean;
};

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
// TWO transitions get the same explicit-confirmation treatment, mirroring "Replace link" on the
// client's own share control (buyer-share-control.tsx) — never a silent action from picking a
// new option in the select:
//   1. Reassigning a link that already carries a DIFFERENT vendor.
//   2. A FIRST attach (no vendor yet) to a vendor that already has an active grant + delivery
//      for this title — that one click makes the master downloadable immediately, so it is the
//      higher-consequence case, not (1).
// Detach (the "No vendor" option) needs no confirmation — it only removes a link's ability to
// resolve the master later, never destroys any grant, delivery, or title state.
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

  async function submit(link: BuyerLink, vendorId: string | null, force: boolean) {
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
    const vendor = vendors.find((v) => v.id === vendorId);
    const isReassignment = Boolean(link.vendorId && link.vendorId !== vendorId);
    const releasesNow = !link.vendorId && Boolean(vendor?.releasesMasterNow);
    if (isReassignment || releasesNow) {
      setConfirming(link.id); // needs the explicit step below, not a silent action
      return;
    }
    void submit(link, vendorId, false);
  }

  if (links.length === 0) {
    return <p className="t-body-sm text-ink-3">No active buyer links for this title.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => {
        const pendingVendorId = choice[link.id] ?? "";
        const pendingVendor = vendors.find((v) => v.id === pendingVendorId);
        const isReassignment = Boolean(link.vendorId && pendingVendorId && link.vendorId !== pendingVendorId);
        const labelId = `buyer-link-vendor-${link.id}`;
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
            <div className="flex flex-col gap-1 pt-1">
              <Label htmlFor={labelId} className="sr-only">
                Vendor for {link.recipientName}
              </Label>
              <div className="flex items-center gap-2">
                <select
                  id={labelId}
                  className={sel}
                  value={pendingVendorId}
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
                      {!link.vendorId && v.releasesMasterNow ? " (releases master now)" : ""}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  onClick={() => onAttachClick(link)}
                  disabled={busyId === link.id || !pendingVendorId || pendingVendorId === link.vendorId}
                >
                  Attach
                </Button>
                {link.vendorId ? (
                  <Button variant="ghost" onClick={() => submit(link, null, false)} disabled={busyId === link.id}>
                    Detach
                  </Button>
                ) : null}
              </div>
            </div>
            {confirming === link.id ? (
              <InlineNotice tone="info" className="flex flex-wrap items-center gap-2">
                {isReassignment ? (
                  <span>
                    Already attached to {link.vendorName}. Reassigning moves this buyer&apos;s master
                    access to {pendingVendor?.name ?? "the new vendor"}.
                  </span>
                ) : (
                  <span>
                    {pendingVendor?.name ?? "This vendor"} already has an active grant and delivery
                    for this title — attaching now releases the master to this link immediately.
                  </span>
                )}
                <Button
                  variant="secondary"
                  onClick={() => submit(link, pendingVendorId, true)}
                  disabled={busyId === link.id}
                >
                  {isReassignment ? "Reassign" : "Attach anyway"}
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
