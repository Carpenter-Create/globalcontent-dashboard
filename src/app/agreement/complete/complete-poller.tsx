"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Payment succeeded on Stripe; wait for the webhook's finalize to flip the org to active
// (avoids bouncing into the agreement gate mid-finalize), then enter the dashboard.
export function CompletePoller() {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let tries = 0;
    let active = true;
    const tick = async () => {
      tries += 1;
      try {
        const res = await fetch("/api/org/status", { cache: "no-store" });
        const { status } = (await res.json()) as { status: string | null };
        if (!active) return;
        if (status === "active") {
          router.replace("/?welcome=1");
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      if (tries >= 15) {
        setSlow(true);
        return;
      }
      setTimeout(tick, 1200);
    };
    tick();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="flex flex-col gap-2">
      <p className="t-body-sm text-body">Payment received — finishing setup…</p>
      {slow ? (
        <Link href="/" className="t-body-sm text-accent">
          Taking longer than expected — go to your dashboard
        </Link>
      ) : null}
    </div>
  );
}
