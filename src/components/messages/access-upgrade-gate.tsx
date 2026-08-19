import Link from "next/link";

import { ASK_GLOBEE } from "@/lib/ask-globee";

export function AccessUpgradeGate() {
  return (
    <div data-ask-globee-gate="" className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col">
      <h1 className="t-section text-ink">{ASK_GLOBEE.pageTitle}</h1>

      <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-6)] py-[var(--space-10)]">
        <p data-ask-globee-headline="" className="t-display text-center text-ink">
          {ASK_GLOBEE.headline}
        </p>
        <div
          data-ask-globee-card=""
          className="flex w-full max-w-[640px] flex-col items-center gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-hairline bg-surface p-[var(--space-6)]"
        >
          <p className="t-body text-center text-ink">{ASK_GLOBEE.analyze}</p>
          <p className="t-body-sm text-center text-ink-3">{ASK_GLOBEE.included}</p>
          <Link
            href={ASK_GLOBEE.upgradeHref}
            data-ask-globee-upgrade=""
            className="inline-flex h-9 items-center justify-center rounded-full bg-accent px-3.5 t-body-sm font-medium text-accent-contrast transition hover:-translate-y-px hover:opacity-90 active:translate-y-0"
          >
            {ASK_GLOBEE.upgrade}
          </Link>
        </div>
      </div>
    </div>
  );
}
