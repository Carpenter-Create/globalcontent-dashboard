"use client";

import { useEffect, useRef, useState } from "react";

import { InlineNotice } from "@/components/ui/inline-notice";
import { PORTAL_COPY } from "@/lib/portal";

// Post-verification screener view (Portal-2 slice 2). Sits behind the SAME identity→code
// gate as the master-download flow (see portal-flow.tsx `ReadyView`) — this component only
// renders once a portal session cookie already exists, so it talks straight to the
// session-scoped /api/portal/screener* routes (no token, no admin client, no secrets here).
//
// Player is a plain instrumented <video> against a progressive-MP4 signed URL. The ABR seam
// (Shaka/dash.js) swaps in here later behind the same /api/portal/screener response shape —
// this component's contract to that route ({ url }) is what must stay stable, not the tag.
type ScreenerEventType = "play" | "pause" | "seek" | "progress" | "ended";
const HEARTBEAT_SECONDS = 10;

export function ScreenerRoom({
  title,
  synopsis,
  runtimeMinutes,
}: {
  title: string;
  synopsis: string | null;
  runtimeMinutes: number | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastHeartbeatAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/portal/screener", { method: "POST" });
      if (cancelled) return;
      if (r.status === 409) return setError(PORTAL_COPY.errorPreparing);
      // A 403 here has two honestly different causes and the route's body says which:
      // PORTAL_COPY.errorExpired means the SESSION lapsed mid-visit (expired/revoked, same
      // meaning as everywhere else that copy appears) — not a statement about the screener at
      // all. PORTAL_COPY.screenerStreamUnavailableNotice means the route's own buyer-link gate
      // fired — a race, not the common path: buyer-page.ts's canWatchScreener mirrors this
      // same rule, so the Watch button (and thus this component) shouldn't normally mount when
      // it would fire; it exists for the window between this page's render and the click
      // landing (e.g. the client flips screener_source back to 'master' in between). Collapsing
      // both into one message told a buyer whose access simply expired that the screener
      // "isn't available yet," which is false — read the body instead of assuming which one it is.
      if (r.status === 403) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        return setError(body?.error ?? PORTAL_COPY.screenerStreamUnavailableNotice);
      }
      if (!r.ok) return setError(PORTAL_COPY.errorExpired);
      const { url } = await r.json();
      setSrc(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fire-and-forget: a dropped or slow event POST must never block or stutter playback.
  function postEvent(eventType: ScreenerEventType, video: HTMLVideoElement) {
    fetch("/api/portal/screener-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        position_seconds: Math.floor(video.currentTime),
        runtime_seconds: Number.isFinite(video.duration) ? Math.floor(video.duration) : null,
      }),
    }).catch(() => {});
  }

  function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (video.currentTime - lastHeartbeatAtRef.current < HEARTBEAT_SECONDS) return;
    lastHeartbeatAtRef.current = video.currentTime;
    postEvent("progress", video);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="t-body font-medium text-ink">{title}</h2>
        {runtimeMinutes != null && (
          <p className="t-body-sm text-ink-3">{runtimeMinutes} min</p>
        )}
      </div>
      {synopsis && <p className="t-body-sm text-ink-2">{synopsis}</p>}

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {!error && (
        <video
          key={src ?? "loading"}
          src={src ?? undefined}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          className="w-full rounded-[var(--radius-sm)] bg-ink"
          onPlay={(e) => postEvent("play", e.currentTarget)}
          onPause={(e) => postEvent("pause", e.currentTarget)}
          onSeeked={(e) => postEvent("seek", e.currentTarget)}
          onEnded={(e) => postEvent("ended", e.currentTarget)}
          onTimeUpdate={onTimeUpdate}
        />
      )}
      {!error && !src && <p className="t-body-sm text-ink-3">{PORTAL_COPY.screenerLoading}</p>}
      <p className="t-body-sm text-ink-3">{PORTAL_COPY.screenerNotice}</p>
    </div>
  );
}
