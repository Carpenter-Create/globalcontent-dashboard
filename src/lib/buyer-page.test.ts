import { describe, expect, it } from "vitest";
import { buyerActionsFor, type BuyerPageState } from "@/lib/buyer-page";

const base: BuyerPageState = {
  titleStatus: "in_delivery",
  hasScreenerAsset: true,
  hasTrailer: true,
  licensed: false,
  screenerIsDedicated: true,
  hasMasterAsset: true,
};

describe("buyerActionsFor", () => {
  it("at pitch: watch, screener download and metadata — never the master", () => {
    const a = buyerActionsFor(base);
    expect(a).toEqual({
      canWatchScreener: true,
      canDownloadScreener: true,
      canDownloadMaster: false,
      canDownloadMetadata: true,
    });
  });

  it("releases the master once this recipient is licensed AND a master asset exists", () => {
    expect(buyerActionsFor({ ...base, licensed: true }).canDownloadMaster).toBe(true);
  });

  // Fix round 2, task 9, item 5: a licensed delivery with nothing uploaded yet must not offer
  // a button that then fails — canDownloadMaster needs BOTH preconditions independently.
  it("withholds the master when licensed but no master asset exists yet", () => {
    expect(buyerActionsFor({ ...base, licensed: true, hasMasterAsset: false }).canDownloadMaster).toBe(false);
  });

  it("withholds the master when a master asset exists but the recipient isn't licensed", () => {
    expect(buyerActionsFor({ ...base, licensed: false, hasMasterAsset: true }).canDownloadMaster).toBe(false);
  });

  it("withholds the screener download before GC approves the title", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "in_review" });
    expect(a.canWatchScreener).toBe(true);
    expect(a.canDownloadScreener).toBe(false);
  });

  it("offers nothing screener-shaped when no screener asset exists", () => {
    const a = buyerActionsFor({ ...base, hasScreenerAsset: false });
    expect(a.canWatchScreener).toBe(false);
    expect(a.canDownloadScreener).toBe(false);
    expect(a.canDownloadMetadata).toBe(true);
  });

  it("still offers metadata on an unapproved title with no assets", () => {
    expect(
      buyerActionsFor({
        titleStatus: "draft",
        hasScreenerAsset: false,
        hasTrailer: false,
        licensed: false,
        screenerIsDedicated: false,
        hasMasterAsset: false,
      }).canDownloadMetadata,
    ).toBe(true);
  });

  it("fails closed on an unknown status", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "some_future_status" });
    expect(a.canDownloadScreener).toBe(false);
  });

  // Fix round 1, task 9, item 1: on the default screener_source = 'master', "the screener" IS
  // the master byte-for-byte (lib/assets.ts). Watching stays open; a one-click DOWNLOAD of
  // that same file must not be — it would hand the unwatermarked deliverable to any prospect
  // holding the link, bypassing the licence gate the master route enforces.
  it("withholds the screener DOWNLOAD when the title's screener is master-sourced, even though watching is fine", () => {
    const a = buyerActionsFor({ ...base, screenerIsDedicated: false });
    expect(a.canWatchScreener).toBe(true);
    expect(a.canDownloadScreener).toBe(false);
    expect(a.canDownloadMetadata).toBe(true);
  });

  it("offers the screener download once the title has a real dedicated screener asset", () => {
    expect(buyerActionsFor({ ...base, screenerIsDedicated: true }).canDownloadScreener).toBe(true);
  });
});
