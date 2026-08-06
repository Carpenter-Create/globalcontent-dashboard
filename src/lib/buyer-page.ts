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
  hasTrailer: boolean;
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
};

export type BuyerActions = {
  canWatchScreener: boolean;
  canDownloadScreener: boolean;
  canDownloadMaster: boolean;
  canDownloadMetadata: boolean;
};

export function buyerActionsFor(state: BuyerPageState): BuyerActions {
  const approved = isPostApprovalTitleStatus(state.titleStatus);
  return {
    canWatchScreener: state.hasScreenerAsset,
    // Watching is fine even on a master-sourced screener (see BuyerPageState's comment) — only
    // the one-click DOWNLOAD needs the dedicated-source gate, since a download hands over a
    // durable file rather than a re-validated stream.
    canDownloadScreener: state.hasScreenerAsset && approved && state.screenerIsDedicated,
    // Never inferred from the title alone: licensed means an active grant AND delivery for
    // THIS recipient, resolved server-side.
    canDownloadMaster: state.licensed,
    canDownloadMetadata: true,
  };
}
