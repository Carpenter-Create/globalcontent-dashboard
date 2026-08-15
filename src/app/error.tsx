"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { APP_ERROR } from "@/lib/app-states";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="sr-only">{APP_ERROR.title}</h1>
      <EmptyState
        title={APP_ERROR.title}
        description={APP_ERROR.description}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button type="button" onClick={reset}>
              {APP_ERROR.retryLabel}
            </Button>
            <Link
              href={APP_ERROR.homeHref}
              className="t-body-sm text-accent transition-colors hover:underline"
            >
              {APP_ERROR.homeLabel}
            </Link>
          </div>
        }
      />
    </main>
  );
}
