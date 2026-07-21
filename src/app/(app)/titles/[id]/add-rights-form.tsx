"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_CATEGORIES, type RightsType } from "@/lib/rights";
import type { TerritoryMode } from "@/lib/territories";
import { addRights } from "./actions";

// One grant per submit: pick a SINGLE rights type, then its own territory and
// exclusivity. Each right carries its own scope — a client may hold SVOD
// worldwide-exclusive AND AVOD US-only-non-exclusive — so rights are added one
// at a time and each appears as its own row in the grants list. Adding the same
// type again with a different territory/exclusivity is allowed (a distinct grant).
// REQUIRED exclusivity choice (no default — §9 conflict-prevention). Operate-capable only.
export function AddRightsForm({ orgId, titleId }: { orgId: string; titleId: string }) {
  const [type, setType] = useState<RightsType | "">("");
  const [mode, setMode] = useState<TerritoryMode>("world");
  const [codes, setCodes] = useState("");
  const [exclusive, setExclusive] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) {
      setError("Select a rights type.");
      return;
    }
    if (exclusive === null) {
      setError("Choose exclusive or non-exclusive.");
      return;
    }
    setSaving(true);
    setError("");
    const countryCodes =
      mode === "world" ? [] : codes.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await addRights({
      orgId,
      titleId,
      rightsTypes: [type],
      mode,
      countryCodes,
      exclusive,
      windowStart: null,
      windowEnd: null,
    });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setType("");
    setCodes("");
    setMode("world");
    setExclusive(null);
    setSaving(false);
  }

  const seg =
    "rounded-[var(--radius-sm)] border px-3 py-1.5 t-body-sm transition-colors";
  const segOn = "border-ink bg-ink text-surface";
  const segOff = "border-hairline bg-surface text-ink-2 hover:text-ink";
  const selectCls =
    "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="t-body-sm text-ink-3">
        Add one right at a time — each carries its own territory and exclusivity.
      </p>

      <div className="flex items-center gap-2">
        <label htmlFor="rights-type" className="t-body-sm text-ink-2">
          Rights type
        </label>
        <select
          id="rights-type"
          value={type}
          onChange={(e) => setType(e.target.value as RightsType | "")}
          className={selectCls}
        >
          <option value="">Select a right…</option>
          {RIGHTS_CATEGORIES.map((cat) => (
            <optgroup key={cat.category} label={cat.category}>
              {cat.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="territory-mode" className="t-body-sm text-ink-2">
          Territory
        </label>
        <select
          id="territory-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as TerritoryMode)}
          className={selectCls}
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

      <fieldset className="flex flex-col gap-1.5">
        <legend className="t-body-sm font-medium text-ink-2">Exclusivity</legend>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={exclusive === true}
            onClick={() => setExclusive(true)}
            className={`${seg} ${exclusive === true ? segOn : segOff}`}
          >
            Exclusive
          </button>
          <button
            type="button"
            aria-pressed={exclusive === false}
            onClick={() => setExclusive(false)}
            className={`${seg} ${exclusive === false ? segOn : segOff}`}
          >
            Non-exclusive
          </button>
        </div>
        <p className="t-body-sm text-ink-3">
          Exclusive: only you may distribute this right in these territories. Non-exclusive: others may too.
        </p>
      </fieldset>

      <Button type="submit" disabled={saving || !type || exclusive === null} className="self-start">
        {saving ? "Adding…" : "Add right"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
