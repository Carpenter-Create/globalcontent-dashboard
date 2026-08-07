import { describe, expect, it } from "vitest";
import { buyerActionsFor, type BuyerPageState } from "@/lib/buyer-page";

// `hasRecipientName: false` — base represents GC's own operational link (no buyer named) so
// every pre-existing test below keeps its original meaning unless a test explicitly opts into
// `hasRecipientName: true` to exercise the buyer-link gate (see the two tests at the bottom).
const base: BuyerPageState = {
  titleStatus: "in_delivery",
  hasScreenerAsset: true,
  licensed: false,
  screenerIsDedicated: true,
  hasMasterAsset: true,
  hasRecipientName: false,
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
        licensed: false,
        screenerIsDedicated: false,
        hasMasterAsset: false,
        hasRecipientName: false,
      }).canDownloadMetadata,
    ).toBe(true);
  });

  it("fails closed on an unknown status", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "some_future_status" });
    expect(a.canDownloadScreener).toBe(false);
  });

  // Fix round 1, task 9, item 1: on the default screener_source = 'master', "the screener" IS
  // the master byte-for-byte (lib/assets.ts). Watching stays open for GC's OWN operational
  // link (no recipient — base's default here); a one-click DOWNLOAD of that same file must
  // not be — it would hand the unwatermarked deliverable to any prospect holding the link,
  // bypassing the licence gate the master route enforces. (The buyer-link case — where
  // watching itself must ALSO close on a master-sourced title — is pinned separately below.)
  it("withholds the screener DOWNLOAD when the title's screener is master-sourced, even though watching is fine for GC's own link", () => {
    const a = buyerActionsFor({ ...base, screenerIsDedicated: false });
    expect(a.canWatchScreener).toBe(true);
    expect(a.canDownloadScreener).toBe(false);
    expect(a.canDownloadMetadata).toBe(true);
  });

  it("offers the screener download once the title has a real dedicated screener asset", () => {
    expect(buyerActionsFor({ ...base, screenerIsDedicated: true }).canDownloadScreener).toBe(true);
  });

  // The buyer-link gate this fix adds: `recipient_name` is the discriminator between a
  // client-minted buyer link and GC's own operational link (see BuyerPageState's
  // hasRecipientName comment). 20260806000200 opened link-minting to every client
  // account_owner/delivery_ops, so a buyer link streaming a master-sourced "screener" is now
  // the same unwatermarked-deliverable leak the download gate above was built to close — just
  // via <video> instead of a download button.
  it("refuses to STREAM a master-sourced screener over a buyer link (named recipient)", () => {
    const a = buyerActionsFor({ ...base, hasRecipientName: true, screenerIsDedicated: false });
    expect(a.canWatchScreener).toBe(false);
    expect(a.canDownloadScreener).toBe(false);
    // Metadata is pitch material regardless — unaffected by this gate.
    expect(a.canDownloadMetadata).toBe(true);
  });

  it("allows a buyer link to stream once the title has a real dedicated screener", () => {
    const a = buyerActionsFor({ ...base, hasRecipientName: true, screenerIsDedicated: true });
    expect(a.canWatchScreener).toBe(true);
    expect(a.canDownloadScreener).toBe(true);
  });

  // Fix round 3, item 2 (CLAUDE.md rule 11 — enforce at the point of action, not just at
  // mint). create_screener_link refuses to MINT a new link for a taken_down title, but a link
  // minted before the takedown re-resolves this function on every later visit — so a
  // taken_down title must stop offering screener access here too, or the mint-time refusal
  // protects nothing once a single link already exists.
  it("withdraws BOTH watching and downloading the screener once the title is taken_down", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "taken_down" });
    expect(a.canWatchScreener).toBe(false);
    expect(a.canDownloadScreener).toBe(false);
    // Metadata is pitch material regardless of status (unchanged) — see the "still offers
    // metadata on an unapproved title" case above.
    expect(a.canDownloadMetadata).toBe(true);
  });

  // The master is NOT gated on `withdrawn`: an already-licensed, already-delivered master is
  // existing state, not a future pitch action — rule 11's own "never retroactively destroy"
  // exception. It stays gated entirely by the delivery's own status (already excludes
  // 'taken_down' — see master-licence.test.ts).
  it("does not withdraw an already-licensed master when the title is taken_down", () => {
    expect(buyerActionsFor({ ...base, titleStatus: "taken_down", licensed: true }).canDownloadMaster).toBe(true);
  });
});
