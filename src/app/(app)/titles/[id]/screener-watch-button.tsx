"use client";

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/ui/inline-notice";

// Client screener preview — a rights holder watching their OWN title's screener. Fetches a
// signed streaming URL from /api/screener/url (RLS-scoped to the caller's org, server-signed)
// and plays it in a modal. View-only markup (controlsList=nodownload, no PiP) mirrors the
// portal + GC players, minus their instrumentation. Styled as a play pill for the dark hero.
export function ScreenerWatchButton({ titleId }: { titleId: string }) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "preparing" | "error">("idle");

  async function watch() {
    setOpen(true);
    setSrc(null);
    setState("loading");
    try {
      const r = await fetch("/api/screener/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId }),
      });
      if (r.status === 202) return setState("preparing");
      if (!r.ok) return setState("error");
      const { url } = (await r.json()) as { url: string };
      setSrc(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={watch}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-band-ink px-4 py-2 t-body-sm font-medium text-band transition hover:-translate-y-px hover:opacity-90 active:translate-y-0"
      >
        <Play className="h-4 w-4 fill-current" strokeWidth={1.5} />
        Watch screener
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Screener" size="xl">
        {state === "loading" ? (
          <div className="flex items-center gap-2 py-6 text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            <span className="t-body-sm">Preparing the screener…</span>
          </div>
        ) : null}
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
      </Dialog>
    </>
  );
}
