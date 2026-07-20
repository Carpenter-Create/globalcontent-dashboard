"use client";

import { useState, useTransition } from "react";

import { InlineNotice } from "@/components/ui/inline-notice";
import { setScreenerSource } from "./actions";

type Source = "master" | "dedicated";

// Client control for a title's screener source: the master doubles as the
// screener (default), or a separately-uploaded "screener" asset is used.
// Writes via the operate-gated set_screener_source RPC (see actions.ts).
export function ScreenerSourceControl({
  titleId,
  current,
}: {
  titleId: string;
  current: Source;
}) {
  const [source, setSource] = useState<Source>(current);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function change(next: Source) {
    if (next === source) return;
    const prev = source;
    setSource(next);
    setError("");
    startTransition(async () => {
      const res = await setScreenerSource({ titleId, source: next });
      if (res.error) {
        setSource(prev);
        setError(res.error);
      }
    });
  }

  return (
    <div>
      <label htmlFor="screener-source" className="t-label text-ink-2 block pb-1">
        Screener source
      </label>
      <select
        id="screener-source"
        value={source}
        disabled={pending}
        onChange={(e) => change(e.target.value as Source)}
        className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
      >
        <option value="master">Use the master</option>
        <option value="dedicated">Use a dedicated screener</option>
      </select>
      <p className="t-body-sm text-ink-3 pt-1">
        {source === "master"
          ? "Your master will be used for screenings."
          : "Upload a Screener asset above; it will be used for screenings."}
      </p>
      {error ? (
        <InlineNotice tone="error" className="mt-2">
          {error}
        </InlineNotice>
      ) : null}
    </div>
  );
}
