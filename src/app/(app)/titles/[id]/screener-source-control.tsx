"use client";

import { useState, useTransition } from "react";

import { InlineNotice } from "@/components/ui/inline-notice";
import { setScreenerSource } from "./actions";

type Source = "master" | "dedicated";

// Client control for a title's screener source: the master doubles as the
// screener (default), or a separately-uploaded "screener" asset is used.
// Writes via the operate-gated set_screener_source RPC (see actions.ts).
//
// The notice below is a STANDING state, not a one-time nudge at upload: a title can be
// switched back to 'master' at any time, and every title predating this control is already
// on it. It clears itself when a screener is uploaded, so there is no dismissal to track.
export function ScreenerSourceControl({
  titleId,
  current,
  isPostApproval,
  hasDedicatedScreener,
}: {
  titleId: string;
  current: Source;
  isPostApproval: boolean;
  hasDedicatedScreener: boolean;
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
      {/* Masters move to cold storage at 90 days; a screener never does. Say what happens and
          what to do about it — the client cannot act on "your master will be used". */}
      {source === "master" && isPostApproval ? (
        <InlineNotice tone="info" className="mt-2">
          Masters move to cold storage 90 days after upload, and retrieval takes 3 to 5 hours. Upload a dedicated
          screener to keep this title playable the moment anyone opens it.
        </InlineNotice>
      ) : null}
      {source === "dedicated" && !hasDedicatedScreener ? (
        <InlineNotice tone="error" className="mt-2">
          No screener has been uploaded yet, so this title cannot be watched. Upload a Screener asset above.
        </InlineNotice>
      ) : null}
      {error ? (
        <InlineNotice tone="error" className="mt-2">
          {error}
        </InlineNotice>
      ) : null}
    </div>
  );
}
