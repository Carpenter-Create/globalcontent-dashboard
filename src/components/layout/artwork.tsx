import { cn } from "@/lib/cn";

// Poster artwork with a graceful greyscale monogram placeholder (layout standard,
// "modern + visual"). Takes an already-signed CloudFront URL (or null). Signing is
// server-side (see @/lib/artwork); this component is presentational and safe anywhere.
// No transcode (GC never transcodes) — the browser scales the source down.
export function Artwork({
  src,
  title,
  className,
  rounded = "rounded-[var(--radius)]",
}: {
  src: string | null;
  title: string;
  className?: string;
  rounded?: string;
}) {
  const initial = (title.trim().charAt(0) || "·").toUpperCase();
  return (
    <div className={cn("relative overflow-hidden bg-surface-muted", rounded, className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL; no next/image remotePatterns needed
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-muted via-surface-muted to-surface">
          <span className="t-data select-none text-3xl font-medium text-ink-3/40">{initial}</span>
        </div>
      )}
    </div>
  );
}
