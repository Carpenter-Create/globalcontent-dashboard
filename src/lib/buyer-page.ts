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
    canDownloadScreener: state.hasScreenerAsset && approved,
    // Never inferred from the title alone: licensed means an active grant AND delivery for
    // THIS recipient, resolved server-side.
    canDownloadMaster: state.licensed,
    canDownloadMetadata: true,
  };
}
