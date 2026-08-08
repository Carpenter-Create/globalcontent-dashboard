// Post-20260808000200 shape of portal_resolve_screener.
//
// database.types.ts is regenerated only after founder applies migrations (AGENTS.md).
// Until then, call sites use this narrow view of the RPC row rather than hand-editing
// generated types. Authorize portal playback on asset_kind from THIS row — never on a
// separately timed titles.screener_source read.

export type PortalResolvedScreener = {
  storage_key: string;
  link_id: string;
  session_id: string;
  title_id: string;
  asset_kind: string;
};

export function asPortalResolvedScreener(row: unknown): PortalResolvedScreener | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (
    typeof r.storage_key !== "string" ||
    typeof r.link_id !== "string" ||
    typeof r.session_id !== "string" ||
    typeof r.title_id !== "string" ||
    typeof r.asset_kind !== "string"
  ) {
    return null;
  }
  return {
    storage_key: r.storage_key,
    link_id: r.link_id,
    session_id: r.session_id,
    title_id: r.title_id,
    asset_kind: r.asset_kind,
  };
}

/** Portal stream/download may proceed only when the resolved asset itself is a screener. */
export function isDedicatedScreenerAsset(row: PortalResolvedScreener): boolean {
  return row.asset_kind === "screener";
}
