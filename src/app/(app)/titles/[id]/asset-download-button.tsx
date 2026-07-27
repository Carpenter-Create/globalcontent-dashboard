"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isClientViewableAssetKind } from "@/lib/assets";

// View & download an asset. Fetches a fresh signed URL from /api/assets/url (RLS-checked,
// server-signed) and opens it in a new tab. Handles the Glacier "restoring" (202) case.
//
// Takes `kind` and renders nothing clickable for the kinds the route will refuse. It uses
// the SAME allow-list the route uses, imported rather than restated — a button that
// renders and then 404s trains people to ignore errors, and a duplicated list drifts.
export function AssetDownloadButton({ assetId, kind }: { assetId: string; kind: string }) {
  const [state, setState] = useState<"idle" | "loading" | "restoring" | "error">("idle");

  // Masters and screeners are not downloadable from here by anyone, including the account
  // owner. Say so plainly rather than showing a control that cannot work.
  if (!isClientViewableAssetKind(kind)) {
    return (
      <span className="t-body-sm text-ink-3">
        {kind === "master" || kind === "screener"
          ? "Delivered to platforms by Global Content — not downloadable here."
          : "Not available for download."}
      </span>
    );
  }

  async function onClick() {
    setState("loading");
    try {
      const res = await fetch("/api/assets/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      if (res.status === 202) {
        setState("restoring");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        disabled={state === "loading"}
        className="w-full justify-center"
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Download className="h-4 w-4" strokeWidth={1.5} />
        )}
        {state === "loading" ? "Preparing…" : "View & download"}
      </Button>
      {state === "restoring" ? (
        <span className="t-body-sm text-ink-3">Restoring from archive — try again in a few hours.</span>
      ) : null}
      {state === "error" ? (
        <span className="t-body-sm text-ink-3">Couldn’t prepare the file. Try again.</span>
      ) : null}
    </div>
  );
}
