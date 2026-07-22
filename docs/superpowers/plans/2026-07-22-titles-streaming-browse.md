# Titles Streaming-Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Titles page feel like a hybrid of a streaming-platform browse experience (Apple TV / Netflix / Tubi — spotlight + poster rails) and an operational catalog (search, a "+ Title" action, and a dense sortable table view).

**Architecture:** Builds on the shipped layout standard (`src/components/layout/*`). The page stays a Server Component with **URL-driven state** (`?q=` search, `?view=browse|table`, `?sort=&dir=`). Browse view = a `SpotlightBanner` + horizontal `Rail`s of `PosterCard`s grouped by category (pure, tested grouping helpers); searching collapses rails into a filtered results grid. Table view = the existing `DataTable`, filtered by `q`. "+ Title" moves from an inline form into a modal (`AddTitleButton` → native `<dialog>` → existing `AddTitleForm`). Search is a small client island; everything else is server-rendered links.

**Tech Stack:** Next.js App Router (Server Components), Tailwind v4 + house tokens, Vitest (node env), lucide-react icons. No new dependencies (native `<dialog>` for the modal).

## Global Constraints

- Greyscale + **one accent** (`--accent` Sporty Blue `#1769ff`); no status colors — accent reserved for the live/active state. Copy verbatim from tokens.
- Design tokens only; type via `.t-*` classes; radius via the `--radius-sm` / `--radius` / `--radius-lg` tokens; numbers use `.t-data`/`tabular-nums`.
- `catalog_id` is **GC-only** — never render it on this client surface (it stays a `gcOnly` DataTable column).
- Logic lives in `lib/` (pure, testable), not components. Copy in `lib/`, not inline JSX where avoidable.
- No schema / RLS / migration in this plan — presentational only. RLS still scopes all reads.
- `pnpm` only (never `npm install`). TypeScript strict. Reduced-motion is handled globally in `globals.css`.
- Verify frontend with Vitest (pure logic) + a throwaway preview route screenshotted via Playwright (visual), then delete the preview route before commit.

---

## File Structure

- `src/lib/titles-browse.ts` — **new.** Pure helpers: `filterTitles`, `groupIntoRails`, `spotlightTitle`, `BrowseTitle` type.
- `src/lib/titles-browse.test.ts` — **new.** Unit tests for the above.
- `src/components/layout/rail.tsx` — **new.** Horizontal-scroll row wrapper.
- `src/components/layout/spotlight-banner.tsx` — **new.** Featured title banner (charcoal band).
- `src/components/layout/search-field.tsx` — **new.** Client, URL-driven debounced `?q=` input.
- `src/components/ui/dialog.tsx` — **new.** Client, native `<dialog>` modal primitive.
- `src/app/(app)/titles/add-title-button.tsx` — **new.** Client, opens the modal with `AddTitleForm`.
- `src/app/(app)/titles/add-title-form.tsx` — **modify.** Add optional `onSuccess?: () => void`.
- `src/lib/catalog-view.ts` — **modify.** `View` becomes `"browse" | "table"`; `parseView` default `"browse"`.
- `src/lib/catalog-view.test.ts` — **modify.** Update the `parseView` test to browse/table.
- `src/components/layout/view-toggle.tsx` — **modify.** Relabel grid→browse (aria + icon), keep API.
- `src/app/(app)/titles/page.tsx` — **modify.** Wire search + view toggle + "+ Title"; browse (spotlight + rails / results grid) and table views.

---

### Task 1: Pure browse helpers (`lib/titles-browse.ts`)

**Files:**
- Create: `src/lib/titles-browse.ts`
- Test: `src/lib/titles-browse.test.ts`

**Interfaces:**
- Consumes: `isUpcoming(releaseDate: string | null, now: Date): boolean` from `@/lib/releases`; `TitleStatus` from `@/lib/titles`.
- Produces:
  - `type BrowseTitle = { id: string; title: string; status: TitleStatus; created_at: string; release_date: string | null; live: number; total: number; posterUrl: string | null }`
  - `filterTitles<T extends { title: string }>(rows: T[], q: string): T[]`
  - `type Rail<T> = { key: string; label: string; rows: T[] }`
  - `groupIntoRails(rows: BrowseTitle[], now: Date): Rail<BrowseTitle>[]`
  - `spotlightTitle(rows: BrowseTitle[], now: Date): BrowseTitle | null`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/titles-browse.test.ts
import { describe, expect, it } from "vitest";
import { filterTitles, groupIntoRails, spotlightTitle, type BrowseTitle } from "./titles-browse";

const NOW = new Date("2026-07-22T00:00:00Z");
const mk = (o: Partial<BrowseTitle> & { id: string; title: string }): BrowseTitle => ({
  status: "draft", created_at: "2026-01-01T00:00:00Z", release_date: null, live: 0, total: 0, posterUrl: null, ...o,
});

describe("filterTitles", () => {
  const rows = [mk({ id: "1", title: "Winter's End" }), mk({ id: "2", title: "Meridian" })];
  it("returns all rows for an empty query", () => {
    expect(filterTitles(rows, "  ").map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("matches title case-insensitively (substring)", () => {
    expect(filterTitles(rows, "mer").map((r) => r.id)).toEqual(["2"]);
    expect(filterTitles(rows, "END").map((r) => r.id)).toEqual(["1"]);
  });
});

describe("groupIntoRails", () => {
  const rows: BrowseTitle[] = [
    mk({ id: "live", title: "Live One", live: 2, total: 3, created_at: "2026-06-01T00:00:00Z" }),
    mk({ id: "up", title: "Upcoming One", status: "in_delivery", release_date: "2026-12-01", created_at: "2026-05-01T00:00:00Z" }),
    mk({ id: "rev", title: "Review One", status: "in_review", created_at: "2026-07-01T00:00:00Z" }),
    mk({ id: "draft", title: "Draft One", status: "draft", created_at: "2026-07-10T00:00:00Z" }),
  ];
  it("emits only non-empty rails in priority order", () => {
    expect(groupIntoRails(rows, NOW).map((r) => r.key)).toEqual([
      "recent", "live", "upcoming", "in_review", "in_progress",
    ]);
  });
  it("omits rails with no matching titles", () => {
    const keys = groupIntoRails([mk({ id: "d", title: "D", status: "draft" })], NOW).map((r) => r.key);
    expect(keys).toEqual(["recent", "in_progress"]);
  });
  it("sorts the upcoming rail soonest-first", () => {
    const many = [
      mk({ id: "far", title: "Far", status: "in_delivery", release_date: "2027-01-01" }),
      mk({ id: "near", title: "Near", status: "in_delivery", release_date: "2026-09-01" }),
    ];
    const upcoming = groupIntoRails(many, NOW).find((r) => r.key === "upcoming")!;
    expect(upcoming.rows.map((r) => r.id)).toEqual(["near", "far"]);
  });
});

describe("spotlightTitle", () => {
  it("returns null for an empty catalog", () => {
    expect(spotlightTitle([], NOW)).toBeNull();
  });
  it("prefers the soonest upcoming release", () => {
    const rows = [
      mk({ id: "live", title: "L", live: 1, total: 1 }),
      mk({ id: "up", title: "U", status: "in_delivery", release_date: "2026-10-01" }),
    ];
    expect(spotlightTitle(rows, NOW)!.id).toBe("up");
  });
  it("falls back to a live title, then the most recent", () => {
    expect(spotlightTitle([mk({ id: "live", title: "L", live: 1 }), mk({ id: "d", title: "D" })], NOW)!.id).toBe("live");
    expect(spotlightTitle([mk({ id: "a", title: "A", created_at: "2026-01-01T00:00:00Z" }), mk({ id: "b", title: "B", created_at: "2026-07-01T00:00:00Z" })], NOW)!.id).toBe("b");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/lib/titles-browse.test.ts`
Expected: FAIL — "Failed to resolve import ./titles-browse" / functions not defined.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/titles-browse.ts
import { isUpcoming } from "@/lib/releases";
import type { TitleStatus } from "@/lib/titles";

export type BrowseTitle = {
  id: string;
  title: string;
  status: TitleStatus;
  created_at: string;
  release_date: string | null;
  live: number;
  total: number;
  posterUrl: string | null;
};

export type Rail<T> = { key: string; label: string; rows: T[] };

const RECENT_COUNT = 12;

/** Case-insensitive substring match on title. Empty/whitespace query → all rows. */
export function filterTitles<T extends { title: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.title.toLowerCase().includes(needle));
}

/**
 * Group titles into streaming-style rails. Rails are emitted in a fixed priority order and
 * only when non-empty. A title may appear in more than one rail (e.g. "Recently added" +
 * "Live"), matching the streaming idiom. Within a rail, order is recency-desc except
 * "Upcoming", which is soonest-first.
 */
export function groupIntoRails(rows: BrowseTitle[], now: Date): Rail<BrowseTitle>[] {
  const byRecency = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const rails: Rail<BrowseTitle>[] = [];

  const recent = byRecency.slice(0, RECENT_COUNT);
  if (recent.length) rails.push({ key: "recent", label: "Recently added", rows: recent });

  const live = byRecency.filter((r) => r.live > 0);
  if (live.length) rails.push({ key: "live", label: "Live", rows: live });

  const upcoming = byRecency
    .filter((r) => isUpcoming(r.release_date, now))
    .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1));
  if (upcoming.length) rails.push({ key: "upcoming", label: "Upcoming", rows: upcoming });

  const inReview = byRecency.filter((r) => r.status === "in_review");
  if (inReview.length) rails.push({ key: "in_review", label: "In review", rows: inReview });

  const inProgress = byRecency.filter(
    (r) =>
      r.live === 0 &&
      (r.status === "draft" || r.status === "submitted" || r.status === "in_delivery"),
  );
  if (inProgress.length) rails.push({ key: "in_progress", label: "In progress", rows: inProgress });

  return rails;
}

/** The featured title: soonest upcoming release, else the most-recent live title, else the most recent. */
export function spotlightTitle(rows: BrowseTitle[], now: Date): BrowseTitle | null {
  if (rows.length === 0) return null;
  const upcoming = rows
    .filter((r) => isUpcoming(r.release_date, now))
    .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1));
  if (upcoming.length) return upcoming[0];
  const byRecency = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return byRecency.find((r) => r.live > 0) ?? byRecency[0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/titles-browse.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/titles-browse.ts src/lib/titles-browse.test.ts
git commit -m "feat(titles): pure browse helpers (filter, rails, spotlight)"
```

---

### Task 2: `View` becomes browse|table (`lib/catalog-view.ts` + toggle)

**Files:**
- Modify: `src/lib/catalog-view.ts` (the `View` type + `parseView` default)
- Modify: `src/lib/catalog-view.test.ts` (the `parseView` test)
- Modify: `src/components/layout/view-toggle.tsx` (labels/icons; API unchanged)

**Interfaces:**
- Produces: `type View = "browse" | "table"`; `parseView(viewParam: string | undefined, fallback: View): View`.

- [ ] **Step 1: Update the failing test**

Replace the `parseView` describe block in `src/lib/catalog-view.test.ts` with:

```ts
describe("parseView", () => {
  it("accepts browse/table, falls back otherwise", () => {
    expect(parseView("table", "browse")).toBe("table");
    expect(parseView("browse", "table")).toBe("browse");
    expect(parseView(undefined, "browse")).toBe("browse");
    expect(parseView("grid", "browse")).toBe("browse"); // old value no longer valid
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/catalog-view.test.ts`
Expected: FAIL — `parseView("browse","table")` returns `"table"` (browse not yet accepted).

- [ ] **Step 3: Update `parseView` and the `View` type**

In `src/lib/catalog-view.ts` replace the `View` type and `parseView`:

```ts
export type View = "browse" | "table";

export function parseView(viewParam: string | undefined, fallback: View): View {
  return viewParam === "browse" || viewParam === "table" ? viewParam : fallback;
}
```

- [ ] **Step 4: Relabel the toggle** (API unchanged — the "grid" slot now means "browse")

In `src/components/layout/view-toggle.tsx`, change the first `ViewLink`'s `label` from `"Poster grid"` to `"Browse"` and its icon import/use from `LayoutGrid` to `LayoutGrid` (keep) — no structural change; only the `aria-label` string `"Poster grid"` → `"Browse"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/catalog-view.test.ts`
Expected: PASS (12 tests, parseView updated).

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-view.ts src/lib/catalog-view.test.ts src/components/layout/view-toggle.tsx
git commit -m "refactor(layout): catalog view browse|table"
```

---

### Task 3: `Rail` + `SpotlightBanner` components

**Files:**
- Create: `src/components/layout/rail.tsx`
- Create: `src/components/layout/spotlight-banner.tsx`

**Interfaces:**
- Consumes: `Artwork` from `@/components/layout/artwork`.
- Produces:
  - `Rail({ label, children }: { label: string; children: React.ReactNode })`
  - `SpotlightBanner({ href, kicker, title, posterUrl, statusLabel, active, meta }: { href: string; kicker?: string; title: string; posterUrl: string | null; statusLabel: string; active?: boolean; meta?: string })`

- [ ] **Step 1: Create `Rail`**

```tsx
// src/components/layout/rail.tsx
// A horizontal-scroll row of cards (streaming rail). Children are fixed-width cells.
export function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="t-label text-ink-3">{label}</h2>
      <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `SpotlightBanner`**

```tsx
// src/components/layout/spotlight-banner.tsx
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Artwork } from "./artwork";

// Featured title, Apple-TV style, on the charcoal band. Poster at left, confident
// title + a band-appropriate status line (no light StatusChip on the dark band).
export function SpotlightBanner({
  href,
  kicker,
  title,
  posterUrl,
  statusLabel,
  active = false,
  meta,
}: {
  href: string;
  kicker?: string;
  title: string;
  posterUrl: string | null;
  statusLabel: string;
  active?: boolean;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="group grid grid-cols-[6rem_1fr] gap-5 overflow-hidden rounded-[var(--radius-lg)] bg-band p-5 text-band-ink transition-all hover:shadow-[var(--elevation)] sm:grid-cols-[8rem_1fr] sm:gap-7 sm:p-7"
    >
      <Artwork src={posterUrl} title={title} className="aspect-[2/3] w-full" />
      <div className="flex flex-col justify-center gap-3">
        {kicker ? <span className="t-label text-accent">{kicker}</span> : null}
        <span className="t-statement leading-tight text-band-ink">{title}</span>
        <div className="flex items-center gap-2 t-label text-band-ink/60">
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-band-ink/40")} />
          {statusLabel}
          {meta ? <span className="text-band-ink/40">· {meta}</span> : null}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/rail.tsx src/components/layout/spotlight-banner.tsx
git commit -m "feat(layout): Rail + SpotlightBanner components"
```

---

### Task 4: `SearchField` (URL-driven, debounced)

**Files:**
- Create: `src/components/layout/search-field.tsx`

**Interfaces:**
- Produces: `SearchField({ placeholder }: { placeholder?: string })` — a client island that reads `?q=` and writes it back debounced.

- [ ] **Step 1: Create the component**

```tsx
// src/components/layout/search-field.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

// Debounced, URL-driven search. Writes ?q= (preserving other params) via router.replace
// so the server re-renders filtered results; no client filtering, no scroll jump.
export function SearchField({ placeholder = "Search titles" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      const trimmed = value.trim();
      if (trimmed) sp.set("q", trimmed);
      else sp.delete("q");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(id);
    // Only re-run when the typed value changes; router/params/pathname are stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-ink-3" strokeWidth={1.5} />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search titles"
        className="h-8 w-44 rounded-full border border-hairline bg-surface pl-8 pr-3 t-body-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none sm:w-56"
      />
    </label>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/components/layout/search-field.tsx`
Expected: PASS (exit 0, no errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/search-field.tsx
git commit -m "feat(layout): URL-driven debounced SearchField"
```

---

### Task 5: `Dialog` primitive + `AddTitleButton` + form `onSuccess`

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Create: `src/app/(app)/titles/add-title-button.tsx`
- Modify: `src/app/(app)/titles/add-title-form.tsx` (add `onSuccess?`)

**Interfaces:**
- Consumes: `AddTitleForm({ orgId, onSuccess })` (extended below); `Button` from `@/components/ui/button`.
- Produces:
  - `Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode })`
  - `AddTitleButton({ orgId }: { orgId: string })`
  - `AddTitleForm` gains `onSuccess?: () => void`, called after a successful create + state reset.

- [ ] **Step 1: Add `onSuccess` to `AddTitleForm`**

In `src/app/(app)/titles/add-title-form.tsx`: change the signature to
`export function AddTitleForm({ orgId, onSuccess }: { orgId: string; onSuccess?: () => void }) {`
and in `onSubmit`, immediately after the existing success resets (`setTitle(""); setReleaseType("new_release"); setOriginalDate(""); setSaving(false);`) add:

```tsx
    onSuccess?.();
```

- [ ] **Step 2: Create the `Dialog` primitive (native `<dialog>`, no dep)**

```tsx
// src/components/ui/dialog.tsx
"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Minimal modal on the native <dialog> element: focus trap, Esc-to-close, and a11y
// come free. No Radix dep. Backdrop click closes.
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop (the dialog element itself)
      }}
      className="m-auto w-[min(92vw,32rem)] rounded-[var(--radius-lg)] border border-hairline bg-surface p-0 text-ink backdrop:bg-[rgb(16_18_26/0.45)] backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <h2 className="t-body font-medium text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-ink-3 transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
```

- [ ] **Step 3: Create `AddTitleButton`**

```tsx
// src/app/(app)/titles/add-title-button.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AddTitleForm } from "./add-title-form";

// The "+ Title" call to action → modal with the existing AddTitleForm. On success the
// dialog closes and the server component re-renders (router.refresh) so the new title appears.
export function AddTitleButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5">
        <Plus className="h-4 w-4" strokeWidth={2} />
        Title
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a title">
        <AddTitleForm
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/components/ui/dialog.tsx "src/app/(app)/titles/add-title-button.tsx" "src/app/(app)/titles/add-title-form.tsx"`
Expected: PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx "src/app/(app)/titles/add-title-button.tsx" "src/app/(app)/titles/add-title-form.tsx"
git commit -m "feat(titles): +Title modal (native dialog) with refresh-on-add"
```

---

### Task 6: Rewire the Titles page (browse × catalog)

**Files:**
- Modify: `src/app/(app)/titles/page.tsx`

**Interfaces:**
- Consumes everything above: `filterTitles`, `groupIntoRails`, `spotlightTitle`, `BrowseTitle`; `Rail`, `SpotlightBanner`, `SearchField`, `AddTitleButton`, `PosterCard`, `ViewToggle`, `DataTable`, `EmptyState`, `Artwork`, `StatusChip`; `parseSort`/`parseView`/`sortRows`/`nextSort`/`buildQuery`; `TITLE_STATUS_LABELS`, `formatReleaseDate`.

- [ ] **Step 1: Replace the page body**

Replace the entire contents of `src/app/(app)/titles/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Clapperboard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { PageStack } from "@/components/layout/page-section";
import { DataTable, type Column } from "@/components/layout/data-table";
import { PosterCard } from "@/components/layout/poster-card";
import { ViewToggle } from "@/components/layout/view-toggle";
import { StatusChip } from "@/components/layout/status-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { Artwork } from "@/components/layout/artwork";
import { Rail } from "@/components/layout/rail";
import { SpotlightBanner } from "@/components/layout/spotlight-banner";
import { SearchField } from "@/components/layout/search-field";
import { AddTitleButton } from "./add-title-button";
import { titleArtworkUrls } from "@/lib/artwork";
import { parseSort, parseView, sortRows, nextSort, buildQuery, type SortDir } from "@/lib/catalog-view";
import { filterTitles, groupIntoRails, spotlightTitle, type BrowseTitle } from "@/lib/titles-browse";
import { TITLE_STATUS_LABELS } from "@/lib/titles";
import { formatReleaseDate } from "@/lib/releases";

const ALLOWED_SORTS = ["title", "status", "live", "release", "catalog", "created"] as const;
const DEFAULT_DIR: Record<string, SortDir> = {
  title: "asc", status: "asc", catalog: "asc", live: "desc", release: "desc", created: "desc",
};

function sortValue(key: string, r: BrowseTitle): string | number | null {
  switch (key) {
    case "title": return r.title.toLowerCase();
    case "status": return TITLE_STATUS_LABELS[r.status];
    case "live": return r.live;
    case "release": return r.release_date;
    case "catalog": return null; // catalog_id is GC-only; not sortable on the client surface
    default: return r.created_at;
  }
}

function statusChipFor(r: BrowseTitle): { label: string; tone: "neutral" | "active" | "muted" } {
  if (r.live > 0) return { label: "Live", tone: "active" };
  return { label: TITLE_STATUS_LABELS[r.status], tone: r.status === "draft" ? "muted" : "neutral" };
}

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = parseView(str(sp.view), "browse");
  const q = (str(sp.q) ?? "").slice(0, 100);
  const sort = parseSort(str(sp.sort), str(sp.dir), ALLOWED_SORTS, { key: "created", dir: "desc" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;
  if (!activeRow) redirect("/");
  const activeOrg = activeRow.organizations!;
  const canOperate = activeRow.role === "account_owner" || activeRow.role === "delivery_ops";

  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, status, created_at, catalog_id, release_date")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false });
  const list = titles ?? [];
  const ids = list.map((t) => t.id);

  const { data: dlv } = ids.length
    ? await supabase.from("deliveries").select("title_id, status").in("title_id", ids)
    : { data: [] as { title_id: string; status: string }[] };
  const counts = new Map<string, { live: number; total: number }>();
  for (const d of dlv ?? []) {
    const c = counts.get(d.title_id) ?? { live: 0, total: 0 };
    c.total += 1;
    if (d.status === "live") c.live += 1;
    counts.set(d.title_id, c);
  }

  const posters = await titleArtworkUrls(supabase, ids);

  const all: BrowseTitle[] = list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    created_at: t.created_at,
    release_date: t.release_date,
    live: counts.get(t.id)?.live ?? 0,
    total: counts.get(t.id)?.total ?? 0,
    posterUrl: posters.get(t.id) ?? null,
  }));

  const now = new Date();
  const filtered = filterTitles(all, q);
  const searching = q.trim().length > 0;

  // URL helpers (preserve q across view/sort changes)
  const qParam = searching ? { q: q.trim() } : {};
  const sortParams = sort.key === "created" && sort.dir === "desc" ? {} : { sort: sort.key, dir: sort.dir };
  const browseHref = buildQuery({ ...qParam, ...sortParams });
  const tableHref = buildQuery({ view: "table", ...qParam, ...sortParams });
  const sortHref = (key: string) => {
    const ns = nextSort(sort, key, DEFAULT_DIR[key] ?? "asc");
    return buildQuery({ view: "table", ...qParam, sort: ns.key, dir: ns.dir });
  };

  const columns: Column<BrowseTitle>[] = [
    { key: "poster", header: "", width: "w-14", cell: (r) => <Artwork src={r.posterUrl} title={r.title} className="h-12 w-8" rounded="rounded-[4px]" /> },
    { key: "title", header: "Title", sortable: true, cell: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: "catalog", header: "Catalog ID", sortable: true, gcOnly: true, cell: () => <span className="text-ink-3">—</span> },
    { key: "status", header: "Status", sortable: true, cell: (r) => { const s = statusChipFor(r); return <StatusChip label={s.label} tone={s.tone} />; } },
    { key: "live", header: "Live", sortable: true, align: "right", width: "w-24", cell: (r) => (r.total > 0 ? <span><span className="text-ink">{r.live}</span><span className="text-ink-3">/{r.total}</span></span> : <span className="text-ink-3">—</span>) },
    { key: "release", header: "Next release", sortable: true, align: "right", width: "w-40", cell: (r) => <span className="text-ink-2">{formatReleaseDate(r.release_date)}</span> },
  ];

  const posterGrid = (items: BrowseTitle[]) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((r) => (
        <PosterCard key={r.id} href={`/titles/${r.id}`} title={r.title} posterUrl={r.posterUrl}
          status={statusChipFor(r)} meta={r.release_date ? formatReleaseDate(r.release_date) : undefined} />
      ))}
    </div>
  );

  const rails = groupIntoRails(filtered, now);
  const spotlight = spotlightTitle(filtered, now);

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Titles"
        subtitle={`${activeOrg.name}'s catalog.`}
        actions={
          <>
            {list.length > 0 ? <SearchField /> : null}
            {list.length > 0 ? <ViewToggle current={view} gridHref={browseHref} tableHref={tableHref} /> : null}
            {canOperate ? <AddTitleButton orgId={activeOrg.id} /> : null}
          </>
        }
      />

      <PageStack>
        {list.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title="No titles yet"
            description={canOperate ? "Add your first title to begin building your catalog." : "Titles will appear here once they're added."}
          />
        ) : searching && filtered.length === 0 ? (
          <EmptyState icon={Clapperboard} title={`No titles match “${q.trim()}”`} description="Try a different search." />
        ) : view === "table" ? (
          <DataTable columns={columns} rows={sortRows(filtered, (r) => sortValue(sort.key, r), sort.dir)} rowKey={(r) => r.id} sort={sort} sortHref={sortHref} rowHref={(r) => `/titles/${r.id}`} isGc={false} />
        ) : searching ? (
          posterGrid(filtered)
        ) : rails.length <= 1 ? (
          posterGrid(filtered)
        ) : (
          <>
            {spotlight ? (
              <SpotlightBanner
                href={`/titles/${spotlight.id}`}
                kicker={spotlight.live > 0 ? "Featured" : spotlight.release_date ? "Next up" : "Featured"}
                title={spotlight.title}
                posterUrl={spotlight.posterUrl}
                statusLabel={statusChipFor(spotlight).label}
                active={spotlight.live > 0}
                meta={spotlight.release_date ? formatReleaseDate(spotlight.release_date) : undefined}
              />
            ) : null}
            {rails.map((rail) => (
              <Rail key={rail.key} label={rail.label}>
                {rail.rows.map((r) => (
                  <div key={r.id} className="w-36 shrink-0 snap-start sm:w-40">
                    <PosterCard href={`/titles/${r.id}`} title={r.title} posterUrl={r.posterUrl}
                      status={statusChipFor(r)} meta={r.release_date ? formatReleaseDate(r.release_date) : undefined} />
                  </div>
                ))}
              </Rail>
            ))}
          </>
        )}
      </PageStack>
    </>
  );
}
```

Note: the inline "Add a title" `PageSection` is removed — adding now happens via the header `AddTitleButton` modal. The `catalog` column keeps `gcOnly: true` and renders a dash (never a value) on this client surface.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "src/app/(app)/titles/page.tsx"`
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/titles/page.tsx"
git commit -m "feat(titles): streaming browse (spotlight + rails), search, table, +Title"
```

---

### Task 7: Visual verification + full suite + PR

**Files:**
- Create (throwaway): `src/app/login/titles-preview/page.tsx`
- Delete before commit: the throwaway route

- [ ] **Step 1: Throwaway preview route** (public, no auth) rendering the browse view, search-results grid, table, spotlight, and empty state with sample `BrowseTitle[]` (reuse the sample-data shape from Task 1's test, add `posterUrl` data-URI SVGs). Mirror the real page's JSX for each state.

- [ ] **Step 2: Run the app + screenshot**

```bash
cp /Users/adamcarpenter/Developer/globalcontent-dashboard/.env.local .env.local   # middleware needs env; not printed
PORT=61790 pnpm dev &
# poll http://localhost:61790/login/titles-preview until 200, then Playwright screenshot light + dark
```
Expected: spotlight banner on the charcoal band, poster rails scroll horizontally, search collapses to a results grid, table view matches the catalog table, empty state renders. Judge at the Mercury/Coinbase + Apple-TV/Netflix bar; iterate on spacing/rail width/hover.

- [ ] **Step 3: Delete the throwaway route + env + screenshots**

```bash
rm -r src/app/login/titles-preview
rm -f .env.local
rm -r .playwright-mcp 2>/dev/null || true
```

- [ ] **Step 4: Full verification**

```bash
pnpm exec tsc --noEmit          # expect 0
pnpm exec eslint .              # expect 0 errors
pnpm exec vitest run            # expect all green (adds titles-browse tests)
```

- [ ] **Step 5: Leak check** — confirm no client component imports the server-only signer, and no secrets in the diff:

```bash
grep -rl '"use client"' src | xargs grep -lE "lib/(cloudfront|artwork)" || echo "clean"
```

- [ ] **Step 6: Commit + push + draft PR**

```bash
git push -u origin feat/titles-streaming-browse
gh pr create --draft --title "feat(titles): streaming-browse catalog — spotlight, rails, search, +Title" --body "<summary>"
```

---

## Self-Review

- **Spec coverage:** streaming feel = `SpotlightBanner` + `Rail`s (Task 3, 6); catalog + search = `SearchField` + filter (Task 4→3? Task 4 is SearchField, Task 1 is filter) (Tasks 1, 4, 6); "+ Title" button = `AddTitleButton` modal (Task 5, 6); table view retained (Task 6). ✓
- **Placeholders:** none — all component and helper code is complete inline. ✓
- **Type consistency:** `BrowseTitle` defined in Task 1 and consumed in Task 6; `View = "browse" | "table"` (Task 2) used in Task 6; `AddTitleForm` `onSuccess?` (Task 5) consumed by `AddTitleButton` (Task 5). `Column<BrowseTitle>` matches the `DataTable` API from the shipped standard. ✓
- **Edge cases:** empty catalog, no-search-match, single-rail fallback to a plain grid, and search-preserved-across-view/sort are all handled in Task 6. ✓
