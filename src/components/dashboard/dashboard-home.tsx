import Link from "next/link";

import { cn } from "@/lib/cn";
import { DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";
import {
  DASHBOARD_HOME,
  dashboardIdentityMeta,
} from "@/lib/dashboard-home";
import { ORG_ROLE_LABELS, ORG_STATUS_LABELS } from "@/lib/clients";
import { TITLE_STATUS_LABELS } from "@/lib/titles";
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
        "dashboard-home-panel flex h-full flex-col rounded-[var(--radius-lg)] border border-hairline bg-surface px-[var(--space-8)] py-[var(--space-10)] sm:px-[var(--space-10)]",
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
        "dashboard-home-pill inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-[var(--space-6)] py-[var(--space-3)] t-body-sm font-medium text-accent-contrast transition hover:-translate-y-px hover:opacity-90 active:translate-y-0",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function DashboardHomeEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-home-empty flex flex-1 flex-col justify-center py-[var(--space-10)]">
      <p className="t-body text-ink-2">{children}</p>
    </div>
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
  const roleLabel = role ? ORG_ROLE_LABELS[role] : null;
  return (
    <header className="dashboard-home-identity min-w-0">
      <h1 className="t-section text-ink">{name}</h1>
      <p className="mt-[var(--space-3)] t-body-sm text-ink-3">
        {dashboardIdentityMeta(ORG_STATUS_LABELS[status], roleLabel)}
      </p>
    </header>
  );
}

export function DashboardSnapshot({
  catalog,
  needsAttention,
  live,
}: {
  catalog: string;
  needsAttention: number;
  live: number;
}) {
  const stats = [
    { key: "catalog", label: DASHBOARD_HOME.catalog, value: catalog, highlight: false },
    {
      key: "needsAttention",
      label: DASHBOARD_HOME.needsAttention,
      value: String(needsAttention),
      highlight: needsAttention > 0,
    },
    { key: "live", label: DASHBOARD_HOME.live, value: String(live), highlight: false },
  ] as const;

  return (
    <dl
      className="dashboard-home-snapshot grid grid-cols-1 overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface sm:grid-cols-3"
      data-dashboard-snapshot=""
    >
      {stats.map((stat, i) => (
        <div
          key={stat.key}
          className={cn(
            "flex flex-col gap-[var(--space-4)] px-[var(--space-8)] py-[var(--space-10)] sm:px-[var(--space-10)]",
            i > 0 && "border-t border-hairline sm:border-t-0 sm:border-l",
          )}
        >
          <dt className="t-label text-ink-3">{stat.label}</dt>
          <dd
            data-dashboard-stat={stat.key}
            className={cn(
              "t-title t-data leading-none",
              stat.highlight ? "text-accent" : "text-ink",
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DashboardDoNext({
  attentionTitleCount,
  drafts,
}: {
  attentionTitleCount: number;
  drafts: { id: string; title: string }[];
}) {
  const hasAttention = attentionTitleCount > 0;
  const hasDrafts = drafts.length > 0;

  return (
    <DashboardHomePanel aria-label={DASHBOARD_HOME.doNext} data-dashboard-do-next="">
      <span className="t-label text-ink-3">{DASHBOARD_HOME.doNext}</span>
      {!hasAttention && !hasDrafts ? (
        <DashboardHomeEmpty>{DASHBOARD_ATTENTION_CLEAR}</DashboardHomeEmpty>
      ) : (
        <div className="mt-[var(--space-8)] flex flex-col">
          {hasAttention ? (
            <div className="flex flex-col gap-[var(--space-3)] pb-[var(--space-8)]">
              <Link
                href="/catalog-health"
                className="t-subhead text-ink transition-colors hover:text-ink-2"
              >
                {dashboardAttentionSummary(attentionTitleCount)}
              </Link>
              <p className="t-body-sm text-ink-3">{DASHBOARD_HOME.attentionReview}</p>
            </div>
          ) : null}
          {hasAttention && hasDrafts ? <div className="border-t border-hairline" /> : null}
          {hasDrafts ? (
            <ul className={cn("divide-y divide-hairline", hasAttention && "pt-[var(--space-2)]")}>
              {drafts.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline justify-between gap-[var(--space-6)] py-[var(--space-6)] first:pt-[var(--space-6)] last:pb-0"
                >
                  <Link
                    href={`/titles/${t.id}`}
                    className="t-body font-medium text-ink transition-colors hover:text-ink-2"
                  >
                    {t.title}
                  </Link>
                  <span className="t-data shrink-0 text-ink-3">{TITLE_STATUS_LABELS.draft}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </DashboardHomePanel>
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
        <ul className="mt-[var(--space-8)] divide-y divide-hairline">
          {titles.map((t) => (
            <li
              key={t.id}
              className="flex items-baseline justify-between gap-[var(--space-6)] py-[var(--space-6)] first:pt-0 last:pb-0"
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
