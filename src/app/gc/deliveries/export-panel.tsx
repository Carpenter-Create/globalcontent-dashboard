"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

export type ExportVendor = { id: string; name: string; titles: { id: string; label: string }[] };

export function ExportPanel({ vendors }: { vendors: ExportVendor[] }) {
  const [vendorId, setVendorId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const vendor = vendors.find((v) => v.id === vendorId);
  const sel = "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function download() {
    if (!vendorId || selected.size === 0) { setError("Pick an endpoint and at least one title."); return; }
    setBusy(true); setError("");
    const res = await fetch("/api/gc/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendorId, titleIds: [...selected] }),
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Export failed."); setBusy(false); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${vendor?.name ?? "export"}-titles.xlsx`; a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-hairline bg-surface-muted p-3">
      <span className="t-body font-medium text-ink">Export metadata sheet</span>
      <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setSelected(new Set()); }} className={sel}>
        <option value="">Select endpoint…</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {vendor ? (
        <div className="flex flex-col gap-1">
          {vendor.titles.length === 0 ? (
            <span className="t-body-sm text-ink-3">No titles with deliveries to this endpoint.</span>
          ) : vendor.titles.map((t) => (
            <label key={t.id} className="flex items-center gap-2 t-body-sm text-ink-2">
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      ) : null}
      <Button onClick={download} disabled={busy || !vendorId || selected.size === 0} className="self-start">
        {busy ? "Preparing…" : "Download .xlsx"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
