"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_CATEGORIES, type RightsType } from "@/lib/rights";
import type { TerritoryMode } from "@/lib/territories";
import { addRights } from "./actions";

// Minimal, functional grants form (not designer-grade): multi-select rights
// types grouped by category, a territory mode, and a comma-separated ISO code
// field for include/exclude. Greyscale errors (D3). Operate-capable only.
export function AddRightsForm({ orgId, titleId }: { orgId: string; titleId: string }) {
  const [types, setTypes] = useState<Set<RightsType>>(new Set());
  const [mode, setMode] = useState<TerritoryMode>("world");
  const [codes, setCodes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(code: RightsType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (types.size === 0) {
      setError("Select at least one rights type.");
      return;
    }
    setSaving(true);
    setError("");
    const countryCodes =
      mode === "world" ? [] : codes.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await addRights({
      orgId,
      titleId,
      rightsTypes: [...types],
      mode,
      countryCodes,
      windowStart: null,
      windowEnd: null,
    });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setTypes(new Set());
    setCodes("");
    setMode("world");
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {RIGHTS_CATEGORIES.map((cat) => (
          <fieldset key={cat.category} className="flex flex-col gap-1.5">
            <legend className="t-body-sm font-medium text-ink-2">{cat.category}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {cat.types.map((t) => (
                <label key={t.code} className="flex items-center gap-1.5 t-body-sm text-ink-2">
                  <input type="checkbox" checked={types.has(t.code)} onChange={() => toggle(t.code)} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="territory-mode" className="t-body-sm text-ink-2">
          Territory
        </label>
        <select
          id="territory-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as TerritoryMode)}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
        >
          <option value="world">Worldwide</option>
          <option value="include">Only these countries</option>
          <option value="exclude">Worldwide except</option>
        </select>
      </div>
      {mode !== "world" ? (
        <Input
          aria-label="ISO country codes"
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          placeholder="Country codes, comma-separated (e.g. US, CA, GB)"
        />
      ) : null}

      <Button type="submit" disabled={saving || types.size === 0} className="self-start">
        {saving ? "Adding…" : "Add rights"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
