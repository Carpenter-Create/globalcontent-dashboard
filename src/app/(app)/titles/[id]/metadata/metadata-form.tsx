"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { METADATA_FIELDS, type FieldDef } from "@/lib/metadata";
import { saveMetadata } from "./actions";

const TIER_ORDER: FieldDef["tier"][] = ["required", "recommended", "optional"];
const TIER_LABEL: Record<FieldDef["tier"], string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

// Build the form value map from stored data (arrays → comma strings for `list`).
function toFormState(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of METADATA_FIELDS) {
    const v = data?.[f.key];
    out[f.key] = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  }
  return out;
}

// Convert form strings back to typed values; omit empties (partial draft).
function toValues(state: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of METADATA_FIELDS) {
    const raw = (state[f.key] ?? "").trim();
    if (raw === "") continue;
    if (f.type === "number") out[f.key] = Number(raw);
    else if (f.type === "list") out[f.key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else out[f.key] = raw;
  }
  return out;
}

export function MetadataForm({
  orgId,
  titleId,
  initial,
}: {
  orgId: string;
  titleId: string;
  initial: Record<string, unknown>;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, string>>(() => toFormState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function set(key: string, value: string) {
    setState((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await saveMetadata(orgId, titleId, toValues(state));
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-xl">
      {TIER_ORDER.map((tier) => (
        <fieldset key={tier} className="flex flex-col gap-3">
          <legend className="t-body-sm font-medium text-ink-2">{TIER_LABEL[tier]}</legend>
          {METADATA_FIELDS.filter((f) => f.tier === tier).map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="t-body-sm text-ink-2">{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={4}
                  className="w-full rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body text-ink outline-none transition-colors focus:border-accent"
                />
              ) : f.type === "select" ? (
                <select
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body text-ink"
                >
                  <option value="">—</option>
                  {(f.vocab ?? []).map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.type === "list" ? "Comma-separated" : undefined}
                />
              )}
            </label>
          ))}
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Saving…" : "Save metadata"}
        </Button>
        {saved ? <span className="t-body-sm text-ink-3">Saved.</span> : null}
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
