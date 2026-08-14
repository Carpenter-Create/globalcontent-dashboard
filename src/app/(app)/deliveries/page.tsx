import Link from "next/link";
import { Send } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { EmptyState } from "@/components/layout/empty-state";
import { StatusChip } from "@/components/layout/status-chip";
import { StatusFilter } from "@/components/layout/status-filter";
import {
  DELIVERIES_FILTER_MISS,
  DELIVERIES_NO_DATA,
  DELIVERY_STATUS_FILTERS,
  deliveriesShowAllHref,
  deliveriesSortHref,
  deliveriesStatusHref,
  deliveryStatusDisplay,
  deliveryTitleHref,
  filterDeliveries,
  normalizeMyDeliveries,
  parseDeliverySort,
  parseDeliveryStatusFilter,
  sortDeliveries,
  type DeliveryBrowseRow,
} from "@/lib/deliveries-browse";

const UPDATED_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatUpdated(value: string | null): string {
  if (value == null || value === "") return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return UPDATED_FMT.format(ms);
}

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseDeliveryStatusFilter(sp.status);
  const sort = parseDeliverySort(sp.sort, sp.dir);

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_deliveries");
  // Untrusted RPC payload — only validated rows may render or produce links.
  const rows = normalizeMyDeliveries(data);
  const filtered = filterDeliveries(rows, statusFilter);
  const sorted = sortDeliveries(filtered, sort);

  const statusHref = (key: (typeof DELIVERY_STATUS_FILTERS)[number]["key"]) =>
    deliveriesStatusHref(statusFilter, sort, key);
  const sortHref = (key: string) => deliveriesSortHref(statusFilter, sort, key);

  const columns: Column<DeliveryBrowseRow>[] = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      cell: (r) => <span className="font-medium text-ink">{r.title}</span>,
    },
    {
      key: "vendor",
      header: "Platform",
      sortable: true,
      cell: (r) => r.vendor_name,
    },
    {
      key: "territory",
      header: "Territory",
      cell: (r) => r.territory,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      cell: (r) => {
        const { label, tone } = deliveryStatusDisplay(r.status);
        return <StatusChip label={label} tone={tone} />;
      },
    },
    {
      key: "updated",
      header: "Updated",
      sortable: true,
      align: "right",
      width: "w-36",
      cell: (r) => <span className="text-ink-2">{formatUpdated(r.updated_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="Deliveries" subtitle="Where your titles are placed and their status." />

      {rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title={DELIVERIES_NO_DATA.title}
          description={DELIVERIES_NO_DATA.description}
          action={
            <Link
              href={DELIVERIES_NO_DATA.actionHref}
              className="t-body-sm text-accent transition-colors hover:underline"
            >
              {DELIVERIES_NO_DATA.actionLabel}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatusFilter
            current={statusFilter}
            options={DELIVERY_STATUS_FILTERS}
            hrefFor={statusHref}
          />
          {filtered.length === 0 ? (
            <EmptyState
              icon={Send}
              title={DELIVERIES_FILTER_MISS.title}
              description={DELIVERIES_FILTER_MISS.description}
              action={
                <Link
                  href={deliveriesShowAllHref(statusFilter, sort)}
                  className="t-body-sm text-accent transition-colors hover:underline"
                >
                  {DELIVERIES_FILTER_MISS.actionLabel}
                </Link>
              }
            />
          ) : (
            <DataTable
              columns={columns}
              rows={sorted}
              rowKey={(r) => r.delivery_id}
              sort={sort}
              sortHref={sortHref}
              rowHref={deliveryTitleHref}
            />
          )}
        </div>
      )}
    </>
  );
}
