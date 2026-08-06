import { describe, it, expect } from "vitest";

import {
  screenerKindFor,
  isPostApprovalTitleStatus,
  isClientViewableAssetKind,
} from "./assets";

// screenerKindFor is the authorization rule BOTH /api/screener/url and the title page call.
// Its failure modes are asymmetric: too strict renders no button (visible, annoying), too
// loose serves an unwatermarked master to someone who should not have it (invisible). Pin
// the whole matrix.
describe("screenerKindFor", () => {
  const PRE_APPROVAL = ["draft", "submitted", "in_review"];
  const POST_APPROVAL = ["in_delivery", "live", "takedown_requested", "taken_down"];

  it("refuses a client on a title GC has not approved yet", () => {
    for (const status of PRE_APPROVAL) {
      expect(screenerKindFor("dedicated", false, status)).toBeNull();
      expect(screenerKindFor("master", false, status)).toBeNull();
    }
  });

  it("serves a client on an approved title, whatever the source", () => {
    for (const status of POST_APPROVAL) {
      expect(screenerKindFor("dedicated", false, status)).toBe("screener");
      // The master fallback for clients is the 2026-08-06 founder decision — a rights
      // holder must be able to watch their own approved title. If this flips back to null,
      // that decision was reverted deliberately, not by accident.
      expect(screenerKindFor("master", false, status)).toBe("master");
    }
  });

  it("serves staff at any status, including pre-approval review", () => {
    for (const status of [...PRE_APPROVAL, ...POST_APPROVAL]) {
      expect(screenerKindFor("master", true, status)).toBe("master");
      expect(screenerKindFor("dedicated", true, status)).toBe("screener");
    }
  });

  it("treats a null/unknown source as the master default", () => {
    expect(screenerKindFor(null, false, "live")).toBe("master");
    expect(screenerKindFor("nonsense", false, "live")).toBe("master");
  });

  it("fails closed for a client on a null or unrecognised status", () => {
    expect(screenerKindFor("dedicated", false, null)).toBeNull();
    expect(screenerKindFor("dedicated", false, "some_future_status")).toBeNull();
  });
});

describe("isPostApprovalTitleStatus", () => {
  it("splits the lifecycle at approval", () => {
    expect(isPostApprovalTitleStatus("in_review")).toBe(false);
    expect(isPostApprovalTitleStatus("in_delivery")).toBe(true);
    expect(isPostApprovalTitleStatus(null)).toBe(false);
  });
});

describe("isClientViewableAssetKind", () => {
  it("admits the trailer and refuses the master and screener", () => {
    expect(isClientViewableAssetKind("trailer")).toBe(true);
    expect(isClientViewableAssetKind("poster")).toBe(true);
    // Both reach viewers through the screener/portal paths, which re-check status and
    // Glacier state; neither is a plain download.
    expect(isClientViewableAssetKind("master")).toBe(false);
    expect(isClientViewableAssetKind("screener")).toBe(false);
  });
});
