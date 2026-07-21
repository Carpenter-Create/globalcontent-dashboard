"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ISO_COUNTRIES } from "@/lib/territories";
import { createDelivery } from "./actions";

// A delivery targets one country (create_delivery requires an ISO alpha-2 code the
// grant covers) — so pick from a list, never type a code. The DB still validates the
// grant covers it. (Enhancement: constrain the list to the selected grant's territories.)
const COUNTRY_OPTS = Object.entries(ISO_COUNTRIES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export type GrantOpt = { id: string; label: string };
export function NewDeliveryForm({
  titles, vendors, grantsByTitle,
}: {
  titles: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  grantsByTitle: Record<string, GrantOpt[]>;
}) {
  const router = useRouter();
  const [titleId, setTitleId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [grantId, setGrantId] = useState("");
  const [territory, setTerritory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const grants = titleId ? grantsByTitle[titleId] ?? [] : [];
  const sel = "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleId || !vendorId || !grantId || !territory.trim()) {
      setError("Pick a title, vendor, grant, and territory.");
      return;
    }
    setBusy(true); setError("");
    const res = await createDelivery({ titleId, vendorId, grantId, territory: territory.trim().toUpperCase() });
    if (res?.error) { setError(res.error); setBusy(false); return; }
    setTitleId(""); setVendorId(""); setGrantId(""); setTerritory("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <span className="t-body font-medium text-ink">New delivery</span>
      <select value={titleId} onChange={(e) => { setTitleId(e.target.value); setGrantId(""); }} className={sel}>
        <option value="">Select title…</option>
        {titles.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={sel}>
        <option value="">Select vendor…</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <select value={grantId} onChange={(e) => setGrantId(e.target.value)} className={sel} disabled={!titleId}>
        <option value="">Select grant…</option>
        {grants.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
      <select value={territory} onChange={(e) => setTerritory(e.target.value)} className={sel}>
        <option value="">Select territory…</option>
        {COUNTRY_OPTS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={busy} className="self-start">{busy ? "Creating…" : "Create delivery"}</Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
