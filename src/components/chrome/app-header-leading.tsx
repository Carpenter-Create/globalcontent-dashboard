"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Mounts children into the app header leading slot after hydrate. SSR/tests
// keep a visually hidden fallback so markup locks can still see the chrome.

export function AppHeaderLeading({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    setHost(document.querySelector("[data-app-header-leading]"));
  }, []);

  if (host) return createPortal(children, host);

  return (
    <div className="sr-only" data-app-header-leading-ssr="">
      {children}
    </div>
  );
}
