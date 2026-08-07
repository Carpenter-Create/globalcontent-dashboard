"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { planParts, planWindows } from "@/lib/upload-plan";

type Kind = "master" | "caption" | "poster" | "banner" | "screener" | "trailer";

// How many parts are in flight at once. Multipart upload exists to be parallel —
// uploading serially wastes almost all of the available bandwidth on a big master.
const CONCURRENCY = 5;

// How many parts we ask the server to sign per round-trip. The sign-parts route
// already accepts an array (up to 1000); batching turns one round-trip per part into
// one per batch. Kept well under the 15-minute presign TTL: we sign a window, upload
// it, then sign the next — so a multi-hour upload never uses a stale URL.
const SIGN_BATCH = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Plain presigned part PUT (SignedHeaders=host) — no checksum header; S3 returns
// the part ETag, collected for CompleteMultipartUpload. Retries back off: an
// immediate retry into a flaky connection usually just fails again.
async function putWithRetry(url: string, body: Blob, tries = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body });
      if (!res.ok) throw new Error(`part upload failed (${res.status})`);
      const etag = res.headers.get("ETag");
      if (!etag) throw new Error("no ETag returned");
      return etag;
    } catch (e) {
      if (attempt >= tries) throw e;
      await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s
    }
  }
}

// Multipart upload direct to S3 — bytes never touch the app (golden rule 14).
// initiate → per window (batch-sign → parallel PUTs) → complete.
export function AssetUpload({ titleId }: { titleId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>("master");
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file.");
      return;
    }
    setError("");
    setPct(0);
    try {
      const init = await fetch("/api/assets/initiate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleId,
          kind,
          filename: file.name,
          contentType: file.type || undefined,
          bytes: file.size,
        }),
      });
      if (!init.ok) throw new Error((await init.json()).error ?? "initiate failed");
      const { uploadId, key, partSize } = await init.json();

      // Byte arithmetic lives in lib/upload-plan and is unit-tested — a boundary bug
      // here would not throw, it would silently assemble a corrupt master.
      const parts = planParts(file.size, partSize);
      const done: { partNumber: number; etag: string }[] = [];
      let completed = 0;

      // Sign a window of parts in ONE round-trip, upload that window with a small
      // worker pool, then move to the next window. Parts finish out of order, which
      // is fine — CompleteMultipartUpload sorts by part number server-side.
      for (const window of planWindows(parts, SIGN_BATCH)) {
        const sign = await fetch("/api/assets/sign-parts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            titleId,
            key,
            uploadId,
            parts: window.map((p) => ({ partNumber: p.partNumber })),
          }),
        });
        if (!sign.ok) throw new Error((await sign.json()).error ?? "sign failed");
        const { urls } = (await sign.json()) as { urls: { partNumber: number; url: string }[] };
        const urlFor = new Map(urls.map((u) => [u.partNumber, u.url]));

        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, window.length) }, async () => {
            while (next < window.length) {
              const part = window[next++];
              const url = urlFor.get(part.partNumber);
              if (!url) throw new Error(`no signed URL for part ${part.partNumber}`);
              const etag = await putWithRetry(url, file.slice(part.start, part.end));
              done.push({ partNumber: part.partNumber, etag });
              completed += 1;
              setPct(Math.round((completed / parts.length) * 100));
            }
          }),
        );
      }

      const complete = await fetch("/api/assets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleId,
          kind,
          key,
          uploadId,
          parts: done,
          bytes: file.size,
          filename: file.name,
          contentType: file.type || undefined,
        }),
      });
      if (!complete.ok) throw new Error((await complete.json()).error ?? "complete failed");

      setFile(null);
      // Reset the native file input too — clearing React state alone leaves the browser
      // still showing the just-uploaded filename next to "Choose File".
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPct(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPct(null);
    }
  }

  return (
    <form onSubmit={onUpload} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          aria-label="Asset kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
        >
          <option value="master">Master</option>
          <option value="trailer">Trailer</option>
          <option value="caption">Caption</option>
          <optgroup label="Artwork">
            <option value="poster">Poster (vertical, ~2:3)</option>
            <option value="banner">Banner (horizontal, 16:9)</option>
          </optgroup>
          <option value="screener">Screener</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Asset file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="t-body-sm text-ink-2"
        />
        <Button type="submit" disabled={pct !== null || !file} className="shrink-0">
          {pct !== null ? `Uploading ${pct}%` : "Upload"}
        </Button>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
