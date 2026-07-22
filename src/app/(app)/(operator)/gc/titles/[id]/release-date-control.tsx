"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RELEASE_TYPE_LABEL, formatReleaseDate, type ReleaseType } from "@/lib/releases";
import { setReleaseDate } from "./actions";

// GC-only control for the forward-looking release date (go-to-market). For a
// re-release this is the re-release date; for a new release it is the first
// release. The client cannot set it (RLS: is_gc_staff on set_release_date).
export function ReleaseDateControl({
  titleId,
  releaseType,
  originalReleaseDate,
  releaseDate,
}: {
  titleId: string;
  releaseType: ReleaseType;
  originalReleaseDate: string | null;
  releaseDate: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(releaseDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(date: string | null) {
    setSaving(true);
    setError("");
    const res = await setReleaseDate({ titleId, date });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="t-label text-ink-3">Release date</span>
      <p className="t-body-sm text-ink-3">
        {RELEASE_TYPE_LABEL[releaseType]}
        {releaseType === "re_release" && originalReleaseDate
          ? ` · original ${formatReleaseDate(originalReleaseDate)}`
          : ""}
        . The go-to-market date shown to the client.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          aria-label="Release date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-[12rem]"
        />
        <Button
          type="button"
          onClick={() => save(value || null)}
          disabled={saving || value === (releaseDate ?? "")}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {releaseDate ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              save(null);
            }}
            disabled={saving}
            className="t-body-sm text-ink-3"
          >
            Clear
          </button>
        ) : null}
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
