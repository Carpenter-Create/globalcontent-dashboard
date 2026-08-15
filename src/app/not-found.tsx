import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { APP_NOT_FOUND } from "@/lib/app-states";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="sr-only">{APP_NOT_FOUND.title}</h1>
      <EmptyState
        title={APP_NOT_FOUND.title}
        description={APP_NOT_FOUND.description}
        action={
          <Link
            href={APP_NOT_FOUND.homeHref}
            className="t-body-sm text-accent transition-colors hover:underline"
          >
            {APP_NOT_FOUND.homeLabel}
          </Link>
        }
      />
    </main>
  );
}
