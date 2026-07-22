"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

// View & download an asset. Fetches a fresh signed URL from /api/assets/url (RLS-checked,
// server-signed) and opens it in a new tab. Handles the Glacier "restoring" (202) case.
export function AssetDownloadButton({ assetId }: { assetId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "restoring" | "error">("idle");

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
