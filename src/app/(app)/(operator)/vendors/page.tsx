import Link from "next/link";
import { Store } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import {
  VENDORS_PAGE,
  normalizeVendorDirectory,
  vendorDirectoryHref,
  vendorDirectoryMeta,
} from "@/lib/vendors-directory";

export default async function GcVendorsPage() {
  const supabase = await createClient();
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, delivery_mode, active")
    .order("name", { ascending: true })
    .range(...rangeFor(UNPAGINATED_MAX));
  const list = normalizeVendorDirectory(vendors);

  return (
    <>
      <PageHeader title={VENDORS_PAGE.title} subtitle={VENDORS_PAGE.identity} />

      <div
        data-vendors-address-book=""
        className="rounded-[12px] border border-hairline bg-surface"
      >
        {list.length === 0 ? (
          <div
            data-vendors-empty=""
            className="flex flex-col items-center gap-[var(--space-4)] px-[var(--space-6)] py-[var(--space-12)] text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-ink-3">
              <Store className="size-6" strokeWidth={1.33} />
            </span>
            <div className="flex flex-col gap-[var(--space-2)]">
              <p className="t-body font-medium text-ink">{VENDORS_PAGE.emptyTitle}</p>
              <p className="t-body-sm text-ink-3">{VENDORS_PAGE.emptySupport}</p>
            </div>
            <Link
              href={VENDORS_PAGE.addHref}
              data-vendors-add=""
              className="t-body-sm text-accent transition-colors hover:underline"
            >
              {VENDORS_PAGE.addVendor}
            </Link>
          </div>
        ) : (
          <ul data-vendors-directory="">
            {list.map((vn) => (
              <li key={vn.id} className="border-b border-hairline last:border-b-0">
                <Link
                  href={vendorDirectoryHref(vn)}
                  className="flex items-center justify-between gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-4)] transition-colors hover:bg-surface-muted"
                >
                  <span className="t-body font-medium text-ink">{vn.name}</span>
                  <span className="t-body-sm text-ink-3">{vendorDirectoryMeta(vn)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
