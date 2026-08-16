import Link from "next/link";

import { cn } from "@/lib/cn";
import { CATALOG_HEALTH_EMPTY, DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";
import { DASHBOARD_HOME } from "@/lib/dashboard-home";
import { ORG_ROLE_LABELS, ORG_STATUS_LABELS } from "@/lib/clients";
import type { OrgRole, OrgStatus } from "@/lib/supabase/context";

const ADDED_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Client-home chrome only. Not the shared Card — a Card/table change must not
// restyle Titles, Deliveries, Catalog Health, or staff surfaces.

export function DashboardHomePanel({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "dashboard-home-panel rounded-[var(--radius-lg)] border border-hairline bg-surface px-[var(--space-8)] py-[var(--space-8)]",
        className,
      )}
      {...props}
    />
  );
}

export function DashboardHomePillLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "dashboard-home-pill inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-4 py-2 t-body-sm font-medium text-accent-contrast transition hover:-translate-y-px hover:opacity-90 active:translate-y-0",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function DashboardHomeEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-home-empty flex flex-col justify-center py-[var(--space-6)]">
      <p className="t-subhead text-ink">{children}</p>
    </div>
  );
}

export function DashboardJustIn({
  titles,
}: {
  titles: { id: string; title: string; created_at: string }[];
}) {
  return (
    <DashboardHomePanel aria-label={DASHBOARD_HOME.justIn}>
      <span className="t-label text-ink-3">{DASHBOARD_HOME.justIn}</span>
      {titles.length === 0 ? (
        <DashboardHomeEmpty>{DASHBOARD_HOME.justInEmpty}</DashboardHomeEmpty>
      ) : (
        <ul className="mt-[var(--space-6)] divide-y divide-hairline">
          {titles.map((t) => (
            <li
              key={t.id}
              className="flex items-baseline justify-between gap-[var(--space-6)] py-[var(--space-4)] first:pt-0 last:pb-0"
            >
              <Link
                href={`/titles/${t.id}`}
                className="t-body font-medium text-ink transition-colors hover:text-ink-2"
              >
                {t.title}
              </Link>
              <span className="t-data shrink-0 text-ink-3">
                {DASHBOARD_HOME.addedPrefix} {ADDED_FMT.format(new Date(t.created_at))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardHomePanel>
  );
}

export function DashboardAttention({ titleCount }: { titleCount: number }) {
  const hasAttention = titleCount > 0;
  return (
    <DashboardHomePanel aria-label={DASHBOARD_HOME.catalogHealthCta}>
      <div className="flex flex-col gap-[var(--space-6)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-[var(--space-2)]">
          <p className="t-subhead text-ink">
            {hasAttention ? dashboardAttentionSummary(titleCount) : DASHBOARD_ATTENTION_CLEAR}
          </p>
          <p className="t-body-sm text-ink-3">
            {hasAttention ? DASHBOARD_HOME.attentionReview : CATALOG_HEALTH_EMPTY}
          </p>
        </div>
        <DashboardHomePillLink href="/catalog-health">
          {DASHBOARD_HOME.catalogHealthCta}
        </DashboardHomePillLink>
      </div>
    </DashboardHomePanel>
  );
}

export function DashboardOrgIdentity({
  name,
  status,
  role,
}: {
  name: string;
  status: OrgStatus;
  role: OrgRole | null;
}) {
  return (
    <div className="dashboard-home-identity flex items-end justify-between gap-[var(--space-6)] border-t border-hairline pt-[var(--space-8)]">
      <div className="flex flex-col gap-1">
        <p className="t-subhead text-ink">{name}</p>
        <p className="t-body-sm text-ink-3">{ORG_STATUS_LABELS[status]}</p>
      </div>
      <span className="rounded-full border border-hairline px-3 py-1 t-label text-ink-2">
        {role ? ORG_ROLE_LABELS[role] : "—"}
      </span>
    </div>
  );
}
