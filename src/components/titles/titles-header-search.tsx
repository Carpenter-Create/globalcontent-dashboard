"use client";

import { Suspense } from "react";

import { SearchField } from "@/components/layout/search-field";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Mobile 528:542 — catalog search lives in the app header, not on a second rail
// and not in shared chrome on `/` or desktop 1:3. Desktop search stays on the
// catalog operate bar.

export function TitlesHeaderSearch() {
  return (
    <div className="min-w-0 flex-1 md:hidden" data-titles-header-search="">
      <Suspense fallback={null}>
        <SearchField placeholder={TITLES_CATALOG.searchPlaceholder} />
      </Suspense>
    </div>
  );
}
