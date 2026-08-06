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
  // POST_APPROVAL_TITLE_STATUSES minus 'taken_down'. 'taken_down' is still a member of that
  // exported list (other consumers need "was this title ever approved" to stay true for it —
  // see ScreenerSourceControl's isPostApproval prop), but it is no longer expected to behave
  // like the others HERE: fix round 3, item 2 pulled it out into its own case below.
  const POST_APPROVAL_STILL_ACTIVE = ["in_delivery", "live", "takedown_requested"];

  it("refuses a client on a title GC has not approved yet", () => {
    for (const status of PRE_APPROVAL) {
      expect(screenerKindFor("dedicated", false, status)).toBeNull();
      expect(screenerKindFor("master", false, status)).toBeNull();
    }
  });

  it("serves a client on an approved, still-active title, whatever the source", () => {
    for (const status of POST_APPROVAL_STILL_ACTIVE) {
      expect(screenerKindFor("dedicated", false, status)).toBe("screener");
      // The master fallback for clients is the 2026-08-06 founder decision — a rights
      // holder must be able to watch their own approved title. If this flips back to null,
      // that decision was reverted deliberately, not by accident.
      expect(screenerKindFor("master", false, status)).toBe("master");
    }
  });

  // Fix round 3, item 2 (CLAUDE.md rule 11 — enforce at the point of action, not just at
  // mint). create_screener_link already refuses to MINT a new link for a taken_down title;
  // this is what makes that refusal mean anything for a link minted BEFORE the takedown.
  it("refuses a client once the title is taken_down, even though it's a POST_APPROVAL_TITLE_STATUS", () => {
    expect(screenerKindFor("dedicated", false, "taken_down")).toBeNull();
    expect(screenerKindFor("master", false, "taken_down")).toBeNull();
  });

  it("serves staff at any status, including taken_down and pre-approval review", () => {
    for (const status of [...PRE_APPROVAL, ...POST_APPROVAL_STILL_ACTIVE, "taken_down"]) {
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

  // Deliberately still true (fix round 3, item 2): this list answers "was this title ever
  // approved," which other consumers (e.g. ScreenerSourceControl's isPostApproval prop) still
  // need. The client-facing takedown gate is a SEPARATE, additional check layered on top in
  // screenerKindFor and buyerActionsFor — not a change to this list's own meaning.
  it("still counts taken_down as post-approval — that fact hasn't changed, only who else gates on it", () => {
    expect(isPostApprovalTitleStatus("taken_down")).toBe(true);
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
