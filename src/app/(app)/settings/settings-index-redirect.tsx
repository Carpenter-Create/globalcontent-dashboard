"use client";

import { useLayoutEffect } from "react";

import { SETTINGS, settingsHashDestination } from "@/lib/settings";

// /settings and leftover hashes. next/navigation redirect() drops the
// fragment, so this replace runs in the browser. The link is the no-JS
// path and the test hook. #agreements still has a leftover destination.
export function SettingsIndexRedirect() {
  useLayoutEffect(() => {
    window.location.replace(settingsHashDestination(window.location.hash));
  }, []);

  return (
    <a href={SETTINGS.profileHref} data-hash-redirect="" className="sr-only">
      {SETTINGS.profileHref}
    </a>
  );
}
