"use client";

import { useLayoutEffect } from "react";

// Leftover hash doors. next/navigation redirect() drops the fragment,
// so this replace runs in the browser. The link is the no-JS path and
// the test hook.
export function HashRedirect({ href }: { href: string }) {
  useLayoutEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <a href={href} data-hash-redirect="" className="sr-only">
      {href}
    </a>
  );
}
