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
  // to stream or hand over as a file. On the (current, default) 'master' setting, "the
  // screener" IS the master, byte for byte (lib/assets.ts screenerKindFor's own comment says
  // so outright). Founder Option D (2026-08-08): BOTH watch and download require dedicated —
  // including GC unnamed operational portal links. The prior unnamed-link watch exemption is
  // removed; dedicated proxy (or uploaded dedicated screener) is the required portal viewing
  // path. Master download remains a separate licence-gated route.
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
  // is non-null). Still required at call sites so pages/routes state which kind of link they
  // resolved (buyer pitch vs GC unnamed ops). Watch eligibility no longer branches on this
  // after Option D — dedicated source is required for both — but omitting the field would
  // again make "forgot to classify the link" a silent default rather than a compile error.
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
    // Dedicated source required for ALL portal watch — named buyer links and GC unnamed
    // operational links alike (founder Option D, 2026-08-08). hasRecipientName is intentionally
    // unused here; do not reintroduce an unnamed master-stream exemption.
    canWatchScreener: state.hasScreenerAsset && !withdrawn && state.screenerIsDedicated,
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
