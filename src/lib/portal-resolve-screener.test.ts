import { describe, expect, it } from "vitest";
import {
  asPortalResolvedScreener,
  isDedicatedScreenerAsset,
} from "@/lib/portal-resolve-screener";

describe("asPortalResolvedScreener / isDedicatedScreenerAsset", () => {
  const base = {
    storage_key: "orgs/o/titles/t/screener/u/f.mp4",
    link_id: "l",
    session_id: "s",
    title_id: "t",
    asset_kind: "screener",
  };

  it("accepts a complete RPC row", () => {
    expect(asPortalResolvedScreener(base)).toEqual(base);
  });

  it("rejects missing asset_kind (fail closed)", () => {
    const rest = {
      storage_key: base.storage_key,
      link_id: base.link_id,
      session_id: base.session_id,
      title_id: base.title_id,
    };
    expect(asPortalResolvedScreener(rest)).toBeNull();
  });

  it("isDedicatedScreenerAsset is true only for kind screener", () => {
    expect(isDedicatedScreenerAsset(base)).toBe(true);
    expect(isDedicatedScreenerAsset({ ...base, asset_kind: "master" })).toBe(false);
    expect(isDedicatedScreenerAsset({ ...base, asset_kind: "trailer" })).toBe(false);
  });
});
