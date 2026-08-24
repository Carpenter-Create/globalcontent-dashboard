"use client";

import { useLayoutEffect, useState } from "react";

import { SETTINGS, settingsHashDestination } from "@/lib/settings";

// /settings and leftover hashes. next/navigation redirect() drops the
// fragment, so this replace runs in the browser. The link is the no-JS
// path and the test hook. #agreements still has a leftover destination.
export function SettingsIndexRedirect() {
  const [href, setHref] = useState(SETTINGS.profileHref);

  useLayoutEffect(() => {
    const next = settingsHashDestination(window.location.hash);
    setHref(next);
    window.location.replace(next);
  }, []);

  return (
    <a href={href} data-hash-redirect="" className="sr-only">
      {href}
    </a>
  );
}
