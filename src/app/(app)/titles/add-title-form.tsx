"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createTitle } from "./actions";

type ReleaseType = "new_release" | "re_release";

// Inline add-a-title form (house form pattern: controlled input, manual validation,
// greyscale inline notice — no red, per known-divergences D3). Write goes through
// the createTitle server action → create_title RPC. The client picks the release
// type and, for a re-release, the historical original date; Global Content owns the
// forward-looking release date, so it is not entered here.
export function AddTitleForm({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [releaseType, setReleaseType] = useState<ReleaseType>("new_release");
  const [originalDate, setOriginalDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const needsOriginal = releaseType === "re_release";
  const valid = title.trim() !== "" && (!needsOriginal || originalDate !== "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (needsOriginal && !originalDate) {
      setError("Original release date is required for a re-release.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await createTitle(
      orgId,
      title.trim(),
      releaseType,
      needsOriginal ? originalDate : undefined,
    );
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setTitle("");
    setReleaseType("new_release");
    setOriginalDate("");
    setSaving(false);
    onSuccess?.();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Input
        aria-label="Title name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title name"
      />

      <div className="flex flex-col gap-1.5">
        <span className="t-label text-ink-3">Release</span>
        <div className="flex gap-4">
          {([
            ["new_release", "New release"],
            ["re_release", "Re-release"],
          ] as const).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 t-body-sm text-ink-2">
              <input
                type="radio"
                name="release_type"
                value={val}
                checked={releaseType === val}
                onChange={() => setReleaseType(val)}
              />
              {label}
            </label>
          ))}
        </div>
        {needsOriginal ? null : (
          <p className="t-body-sm text-ink-3">Global Content sets the release date.</p>
        )}
      </div>

      {needsOriginal ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="original_release_date" className="t-label text-ink-3">
            Original release date
          </Label>
          <Input
            id="original_release_date"
            type="date"
            value={originalDate}
            onChange={(e) => setOriginalDate(e.target.value)}
          />
        </div>
      ) : null}

      <Button type="submit" disabled={saving || !valid} className="shrink-0 self-start">
        {saving ? "Adding…" : "Add title"}
      </Button>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
