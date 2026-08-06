import type { NextConfig } from "next";

// Artwork is served from CloudFront in production and from presigned S3 in local/preview
// (see lib/asset-url). next/image will only optimise a remote source whose host is listed
// here, so both paths need an entry or images silently fall back to unoptimised.
//
// The CloudFront host is read from env rather than hardcoded so this follows the
// distribution; the literal is a fallback for builds where the var is absent.
const cloudfrontHost = (() => {
  const raw = process.env.CLOUDFRONT_DOMAIN;
  if (!raw) return "delivery.globalcontent.co";
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
  } catch {
    return "delivery.globalcontent.co";
  }
})();

const nextConfig: NextConfig = {
  // Next serves its dev origin as localhost; without this, hitting the app via
  // 127.0.0.1 is treated as cross-origin and dev resources (incl. client hydration)
  // are blocked — the widget/hydration then silently fails. Allow both in dev.
  allowedDevOrigins: ["127.0.0.1"],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: cloudfrontHost },
      // Local/preview presigned S3. Both addressing styles, dev bucket only — the prod
      // bucket is never served directly, it is CloudFront + OAC only.
      { protocol: "https", hostname: "gc-content-assets-dev.s3.us-east-1.amazonaws.com" },
      { protocol: "https", hostname: "s3.us-east-1.amazonaws.com" },
    ],
    // Artwork is photographic; AVIF first, WebP fallback.
    formats: ["image/avif", "image/webp"],
    // Match the cache to the signed-URL window (PORTAL.artworkTtlSeconds). No point
    // holding a derivative longer than its source URL stays valid.
    minimumCacheTTL: 3600,
  },
};

export default nextConfig;
