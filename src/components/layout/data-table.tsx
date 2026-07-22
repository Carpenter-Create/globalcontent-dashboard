import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Sort } from "@/lib/catalog-view";

// The ONE collection renderer for working surfaces (layout standard). Columns are
// declared as data; one <table> renders every list identically. Server component —
// sorting is URL-driven (the page sorts, passes rows + `sort` + `sortHref`), so there
// is no client JS. gcOnly columns render only for GC operators. Real semantic <table>
// for accessibility; the whole row is a stretched link when `rowHref` is given.
export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  gcOnly?: boolean;
  width?: string; // tailwind width util, e.g. "w-36"
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  sortHref,
  rowHref,
  isGc = false,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: Sort;
  /** Builds the href for a column header; required if any column is sortable. */
  sortHref?: (key: string) => string;
  rowHref?: (row: T) => string;
  isGc?: boolean;
  empty?: React.ReactNode;
}) {
  const cols = columns.filter((c) => !c.gcOnly || isGc);
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            {cols.map((c) => {
              const active = sort?.key === c.key;
              const alignCls = c.align === "right" ? "text-right" : "text-left";
              const inner = (
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    c.align === "right" && "flex-row-reverse",
                  )}
                >
                  {c.header}
                  {c.sortable && active ? (
                    sort!.dir === "asc" ? (
                      <ArrowUp className="h-3 w-3" strokeWidth={2} />
                    ) : (
                      <ArrowDown className="h-3 w-3" strokeWidth={2} />
                    )
                  ) : null}
                </span>
              );
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn("px-4 py-2.5 t-label text-ink-3", alignCls, c.width)}
                >
                  {c.sortable && sortHref ? (
                    <Link
                      href={sortHref(c.key)}
                      className={cn(
                        "inline-flex transition-colors hover:text-ink-2",
                        active && "text-ink-2",
                      )}
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="group relative border-b border-hairline transition-colors last:border-0 hover:bg-surface-muted"
            >
              {cols.map((c, ci) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-3 align-middle t-body-sm text-ink",
                    c.align === "right" && "text-right tabular-nums text-ink-2",
                    c.width,
                  )}
                >
                  {ci === 0 && rowHref ? (
                    <Link
                      href={rowHref(row)}
                      className="after:absolute after:inset-0 after:content-['']"
                    >
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
