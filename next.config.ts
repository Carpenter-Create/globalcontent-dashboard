import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next serves its dev origin as localhost; without this, hitting the app via
  // 127.0.0.1 is treated as cross-origin and dev resources (incl. client hydration)
  // are blocked — the widget/hydration then silently fails. Allow both in dev.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
