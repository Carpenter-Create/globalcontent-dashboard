"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { markNotificationsRead } from "./actions";

// Per-message "Mark as read" — reuses the shared action with a single id.
export function MarkRead({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead([id]);
          router.refresh(); // refresh the row + the layout's nav unread badge
        })
      }
      className="shrink-0 t-label text-ink-3 underline-offset-2 transition-colors hover:text-ink-2 hover:underline disabled:opacity-50"
    >
      Mark as read
    </button>
  );
}
