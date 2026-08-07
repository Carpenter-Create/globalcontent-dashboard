import { isPostApprovalTitleStatus } from "@/lib/assets";

// THE rule set for the buyer portal page. The page and both download routes read this, so a
// button can never render for a request that would be refused — and, more importantly, so the
// master gate is one testable expression rather than three scattered conditionals.
//
// Metadata is always available: it is the pitch material, and a buyer evaluating a title needs
// the specs whether or not a screener has been uploaded yet.
export type BuyerPageState = {
  titleStatus: string | null;
  hasScreenerAsset: boolean;
  licensed: boolean;
  // Whether THIS title's screener_source is 'dedicated' — a purpose-made viewing copy, safe
  // to hand over as a file. On the (current, default) 'master' setting, "the screener" IS the
  // master, byte for byte (lib/assets.ts screenerKindFor's own comment says so outright):
  // fine to WATCH in-room (no different from any other pitch view) but never fine to
  // DOWNLOAD, since a download is a bearer file handed to whoever holds the link — it would
  // release the unwatermarked deliverable to any prospect, bypassing the licence gate
  // entirely. Founder-approved interim fix (fix round 1, task 9): once every title has a
  // real dedicated screener-proxy asset, this is always true and stops gating anything.
  screenerIsDedicated: boolean;
  // Whether a `kind = 'master'` asset row actually exists for the title. Fix round 2, task 9,
  // item 5: `licensed` alone used to be enough to render the "Download master" card, but the
  // route separately 403s when there is no master asset to serve — a licensed delivery with
  // nothing uploaded yet rendered a button that then reported failure. Kept as its own field
  // (not folded into `licensed`) for the same reason `screenerIsDedicated` is separate: each
  // is an independent precondition with its own reason to be false, and collapsing them would
  // make a future "why is this button/error here" question unanswerable from the type alone.
  hasMasterAsset: boolean;
  // Whether the link resolving THIS request names a recipient (`portal_links.recipient_name`
  // is non-null). This is the discriminator between a client-minted BUYER link and GC's own
  // operational screener link (minted with no recipient — chain-of-title review, a vendor
  // reviewer, etc.). Required, not optional: 20260806000200 widened link-minting from
  // GC-staff-only to every client account_owner/delivery_ops with no per-link limit, which
  // means a master-sourced title's unwatermarked deliverable can now reach an unlicensed
  // outsider through a buyer link — the same bytes GC's own workflow has always been trusted
  // with. Making this field required (not `boolean | undefined`) forces every call site to
  // state which kind of link it is rather than defaulting to "safe," so a caller that forgets
  // it is a compile error, not a silently-open gate.
  hasRecipientName: boolean;
};

export type BuyerActions = {
  canWatchScreener: boolean;
  canDownloadScreener: boolean;
  canDownloadMaster: boolean;
  canDownloadMetadata: boolean;
};

export function buyerActionsFor(state: BuyerPageState): BuyerActions {
  const approved = isPostApprovalTitleStatus(state.titleStatus);
  // Rule 11 (fix round 3, item 2): enforce at the point of action, not just at mint.
  // create_screener_link (20260806000200) refuses to MINT a new link for a taken_down title,
  // but a link minted before the takedown re-resolves this function on every subsequent visit
  // — so withdrawal has to be enforced here too, or the mint-time refusal protects nothing
  // once a single link already exists. 'taken_down' stays IN isPostApprovalTitleStatus's list
  // on purpose (it still answers "was this title ever approved" for other callers); this is a
  // second, independent gate on top of it, not a replacement for it.
  const withdrawn = state.titleStatus === "taken_down";
  return {
    // Watching a withdrawn title is still pitching it — same reasoning as the download gate
    // below, just without the dedicated-source condition.
    //
    // The dedicated-source condition IS applied here, but only for a buyer link
    // (hasRecipientName). On the 'master' default, "the screener" IS the master byte-for-byte
    // (see BuyerPageState's comment on screenerIsDedicated) — a browser <video> stream and a
    // one-click download differ only in how many clicks it takes a recipient to walk off with
    // an unwatermarked deliverable; the earlier fix closed the download and left the stream
    // open beside it. GC's own operational links (no recipient — chain-of-title review, a
    // vendor reviewer under GC's own workflow) are deliberately NOT gated here: that risk
    // predates this branch and is GC's to carry, and breaking a working internal flow today
    // would be collateral damage, not a fix. Do not "tidy" this into a blanket
    // `screenerIsDedicated` check — that would break GC's own screening of a title that has
    // never had a dedicated screener uploaded.
    canWatchScreener: state.hasScreenerAsset && !withdrawn && (!state.hasRecipientName || state.screenerIsDedicated),
    // Watching is fine even on a master-sourced screener (see BuyerPageState's comment) — only
    // the one-click DOWNLOAD needs the dedicated-source gate, since a download hands over a
    // durable file rather than a re-validated stream.
    canDownloadScreener: state.hasScreenerAsset && approved && !withdrawn && state.screenerIsDedicated,
    // Deliberately NOT gated on `withdrawn`: an already-licensed, already-delivered master is
    // existing state, not a future action — rule 11's own exception ("never retroactively
    // destroy existing state"). `deliveries.status` and `titles.status` are INDEPENDENT
    // columns — nothing cascades between them, so a `taken_down` title can still have a
    // `live` delivery, and `licensed` would still be true for it. The protection here is not
    // "the title's status already excludes this" (it doesn't); it's that GC must actively end
    // the grant or delivery (master-licence.ts's ACTIVE_DELIVERY_STATUSES) to close this off —
    // the same "enforce at the point of action, on the record that action actually reads"
    // reasoning as the rest of rule 11, just resting on the delivery's status rather than the
    // title's. Never inferred from the title alone: licensed means an active grant AND
    // delivery for THIS recipient, resolved server-side. hasMasterAsset is the second,
    // independent precondition the route itself enforces (there must be something to actually
    // serve).
    canDownloadMaster: state.licensed && state.hasMasterAsset,
    canDownloadMetadata: true,
  };
}
