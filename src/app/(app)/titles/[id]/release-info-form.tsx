"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RELEASE_TYPE_LABEL, formatReleaseDate, type ReleaseType } from "@/lib/releases";
import { setTitleReleaseInfo } from "./actions";

// Client-owned release info on the title detail: release type + (re-release only)
// the historical original date. The forward-looking release date is GC-owned and
// shown read-only here. Operators get an inline editor; others see it read-only.
export function ReleaseInfoForm({
  orgId,
  titleId,
  releaseType,
  originalReleaseDate,
  releaseDate,
  canOperate,
}: {
  orgId: string;
  titleId: string;
  releaseType: ReleaseType;
  originalReleaseDate: string | null;
  releaseDate: string | null;
  canOperate: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<ReleaseType>(releaseType);
  const [originalDate, setOriginalDate] = useState(originalReleaseDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const needsOriginal = type === "re_release";
  const valid = !needsOriginal || originalDate !== "";

  async function onSave() {
    if (needsOriginal && !originalDate) {
      setError("Original release date is required for a re-release.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await setTitleReleaseInfo({
      orgId,
      titleId,
      releaseType: type,
      originalReleaseDate: needsOriginal ? originalDate : undefined,
    });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="t-label text-ink-3">Release</span>
          {canOperate ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="t-body-sm text-accent"
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="flex items-baseline justify-between gap-4 t-body-sm">
          <span className="text-ink-3">Type</span>
          <span className="text-ink-2">{RELEASE_TYPE_LABEL[releaseType]}</span>
        </div>
        {releaseType === "re_release" ? (
          <div className="flex items-baseline justify-between gap-4 t-body-sm">
            <span className="text-ink-3">Original release</span>
            <span className="text-ink-2">{formatReleaseDate(originalReleaseDate)}</span>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 t-body-sm">
          <span className="text-ink-3">Release date</span>
          <span className="text-ink-2">
            {releaseDate ? formatReleaseDate(releaseDate) : "Set by Global Content"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="t-label text-ink-3">Release</span>
      <div className="flex gap-4">
        {([
          ["new_release", "New release"],
          ["re_release", "Re-release"],
        ] as const).map(([val, label]) => (
          <label key={val} className="flex items-center gap-2 t-body-sm text-ink-2">
            <input
              type="radio"
              name="release_type_edit"
              value={val}
              checked={type === val}
              onChange={() => setType(val)}
            />
            {label}
          </label>
        ))}
      </div>

      {needsOriginal ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit_original_release_date" className="t-label text-ink-3">
            Original release date
          </Label>
          <Input
            id="edit_original_release_date"
            type="date"
            value={originalDate}
            onChange={(e) => setOriginalDate(e.target.value)}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={onSave} disabled={saving || !valid}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setType(releaseType);
            setOriginalDate(originalReleaseDate ?? "");
            setError("");
          }}
          className="t-body-sm text-ink-3"
        >
          Cancel
        </button>
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
