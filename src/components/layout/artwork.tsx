import Image from "next/image";

import { cn } from "@/lib/cn";

// Poster/banner artwork with a graceful greyscale monogram placeholder (layout standard,
// "modern + visual"). Takes an already-signed URL (or null); signing is server-side (see
// @/lib/artwork), so this component is presentational and safe anywhere.
//
// WHY next/image AND NOT A PLAIN <img>. Sources are the real uploads — measured at
// 2.5–3.2 MB, 2000x3000 — and this renders them into cells as small as 32px wide. A plain
// <img> downloads every byte and lets the browser scale it, so a catalog grid pulled
// megabytes of JPEG per page. That was ~1.1s of a ~1.5s navigation, against a server
// render of only ~180ms. next/image serves a resized, modern-format derivative at roughly
// the pixels actually needed.
//
// This only works because signed URLs are now STABLE within their window (see
// lib/signing-window). Previously each render minted a new signature, so the optimiser --
// like the browser -- saw a brand-new URL every time and re-fetched the original.
//
// GC still never transcodes the MASTER (spec §12). This is display-only derivation of
// promotional artwork; the stored object is untouched.
export function Artwork({
  src,
  title,
  className,
  rounded = "rounded-[var(--radius)]",
  /** Tell the optimiser the rendered width so it does not ship a hero-sized image to a
   *  table thumbnail. Defaults to a catalog-grid cell. */
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  priority = false,
}: {
  src: string | null;
  title: string;
  className?: string;
  rounded?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const initial = (title.trim().charAt(0) || "·").toUpperCase();
  return (
    <div className={cn("relative overflow-hidden bg-surface-muted", rounded, className)}>
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          className="object-cover"
          priority={priority}
          // Signed URLs carry an expiry; a failed load should degrade to the placeholder
          // rather than a broken-image icon.
          unoptimized={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-muted via-surface-muted to-surface">
          <span className="t-data select-none text-3xl font-medium text-ink-3/40">{initial}</span>
        </div>
      )}
    </div>
  );
}
