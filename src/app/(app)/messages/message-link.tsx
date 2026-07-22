"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { markNotificationsRead } from "./actions";

// A message link that marks the notification read on click, then navigates to where the
// client acts on it. "Read" = seen (clicking to open the title is a clear signal you've seen
// it); "still needs fixing" lives on the title itself, not here. If already read, it's a plain
// Link (Next prefetch preserved). The explicit per-row "Mark as read" button still handles
// dismissing a message without opening it.
export function MessageLink({
  id,
  href,
  unread,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (!unread) return; // already read → let Link navigate normally
        e.preventDefault();
        start(async () => {
          await markNotificationsRead([id]);
          router.push(href);
        });
      }}
    >
      {children}
    </Link>
  );
}
