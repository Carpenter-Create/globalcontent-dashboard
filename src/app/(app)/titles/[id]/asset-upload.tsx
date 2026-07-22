"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

type Kind = "master" | "caption" | "artwork" | "screener";

// Plain presigned part PUT (SignedHeaders=host) — no checksum header; S3 returns
// the part ETag, collected for CompleteMultipartUpload.
async function putWithRetry(url: string, body: Blob, tries = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body });
      if (!res.ok) throw new Error(`part upload failed (${res.status})`);
      const etag = res.headers.get("ETag");
      if (!etag) throw new Error("no ETag returned");
      return etag;
    } catch (e) {
      if (attempt >= tries) throw e;
    }
  }
}

// Multipart upload direct to S3: initiate → per part (sign → PUT) → complete.
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

      const partCount = Math.max(1, Math.ceil(file.size / partSize));
      const done: { partNumber: number; etag: string }[] = [];
      for (let i = 0; i < partCount; i++) {
        const partNumber = i + 1;
        const blob = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
        const sign = await fetch("/api/assets/sign-parts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ titleId, key, uploadId, parts: [{ partNumber }] }),
        });
        if (!sign.ok) throw new Error((await sign.json()).error ?? "sign failed");
        const { urls } = await sign.json();
        const etag = await putWithRetry(urls[0].url, blob);
        done.push({ partNumber, etag });
        setPct(Math.round((partNumber / partCount) * 100));
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
          <option value="caption">Caption</option>
          <option value="artwork">Artwork</option>
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
