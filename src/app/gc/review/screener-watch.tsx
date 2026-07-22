"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

// GC-internal screener preview. Plays the title's screener source inline for GC staff with NO
// OTP and NO engagement logging — this is a silent operator preview, kept out of the external
// Viewer-activity record. Streams a signed CloudFront URL from /api/gc/screener-url; view-only
// markup (controlsList=nodownload, no PiP) mirrors the portal player, minus its instrumentation.
export function ScreenerWatch({ titleId }: { titleId: string }) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "preparing" | "error">("idle");

  async function watch() {
    setOpen(true);
    setSrc(null);
    setState("loading");
    try {
      const r = await fetch("/api/gc/screener-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId }),
      });
      if (r.status === 202) return setState("preparing");
      if (!r.ok) return setState("error");
      const { url } = await r.json();
      setSrc(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!open || state === "error" ? (
        <Button variant="secondary" onClick={watch} className="shrink-0 self-start">
          Watch screener
        </Button>
      ) : null}

      {state === "loading" ? <p className="t-body-sm text-ink-3">Preparing the screener…</p> : null}
      {state === "preparing" ? (
        <InlineNotice tone="info">
          This title&apos;s master is in cold storage — retrieval takes about 3 to 5 hours. Try again once it&apos;s
          ready.
        </InlineNotice>
      ) : null}
      {state === "error" ? (
        <InlineNotice tone="error">Could not load the screener. Please try again.</InlineNotice>
      ) : null}

      {src ? (
        <video
          key={src}
          src={src}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          autoPlay
          className="w-full rounded-[var(--radius-sm)] bg-ink"
        />
      ) : null}
    </div>
  );
}
