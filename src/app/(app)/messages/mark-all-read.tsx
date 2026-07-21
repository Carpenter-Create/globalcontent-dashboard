"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { markAllRead } from "./actions";

export function MarkAllRead({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllRead(ids);
          router.refresh(); // refresh the page + the layout's nav unread badge
        })
      }
    >
      Mark all read
    </Button>
  );
}
