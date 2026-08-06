import { describe, expect, it } from "vitest";
import { buyerActionsFor, type BuyerPageState } from "@/lib/buyer-page";

const base: BuyerPageState = {
  titleStatus: "in_delivery",
  hasScreenerAsset: true,
  hasTrailer: true,
  licensed: false,
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

  it("releases the master once this recipient is licensed", () => {
    expect(buyerActionsFor({ ...base, licensed: true }).canDownloadMaster).toBe(true);
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
      buyerActionsFor({ titleStatus: "draft", hasScreenerAsset: false, hasTrailer: false, licensed: false })
        .canDownloadMetadata,
    ).toBe(true);
  });

  it("fails closed on an unknown status", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "some_future_status" });
    expect(a.canDownloadScreener).toBe(false);
  });
});
