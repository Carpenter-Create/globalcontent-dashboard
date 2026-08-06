# Buyer Title Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One link per buyer that opens a GC-branded title page — trailer, screener and metadata side by side — from which the buyer downloads the screener and an XLSX metadata sheet, and, once their licence is live, the master.

**Architecture:** No new route and no new link purpose. `/portal/[token]` already resolves links and runs the OTP gate; only the `ready` branch for `screener_view` changes. `portal_links` gains a recipient (`vendor_id` + display name). The master appears when an active grant and delivery exist for that recipient — the rule-12 check `portal_resolve_download` already performs. The XLSX comes from the existing export engine with a buyer template, not a second exporter.

**Tech Stack:** Next.js App Router (server components), Supabase (Postgres + RLS + SECURITY DEFINER RPCs), `exceljs`, Vitest, pgTAP, Tailwind with design tokens.

## Global Constraints

- **Source spec:** `docs/superpowers/specs/2026-08-06-buyer-title-page-design.md`. It governs; this plan implements it.
- **Package manager is `pnpm`.** Never `npm install`.
- **Destructive-ops rule:** migrations, RLS/policy changes and permission changes require the exact SQL shown to the founder and explicit approval before applying. A `PreToolUse` hook blocks `supabase migration up`; the founder runs it.
- **Money is integer cents; UUID PKs; `timestamptz`; `snake_case`.** Not exercised here but binding.
- **Every RPC parameter that callers may omit must be declared `… default null`** or generated TS types mark it required. (Known gotcha; bit this repo three times.)
- **Independent Supabase queries in a server component must be `Promise.all`'d.**
- **Never call `supabase.auth.getUser()`** — use `getAuthUser()` / `getOrgContext()` from `lib/supabase`.
- **Copy voice:** calm, restrained, declarative. Banned words include *seamless, frictionless, white-glove, elevate, best-in-class*. Prices end in 7.
- **Design tokens only** — never hardcode hex.
- **Nothing is ever deleted** — status changes only.
- **Verification per task:** `pnpm typecheck && pnpm test && pnpm exec eslint src`. `pnpm lint` is currently red from `.claude/worktrees`; lint `src` only.

## Sequencing note

Task 4 modifies `supabase/migrations/20260806000200_client_screener_share_links.sql`, which is **written but not yet applied**. If it has been applied by the time this runs, do not edit it — write a new migration with the same content changes instead.

## Unresolved design detail — read before Task 5

The spec assumes the link names a recipient so the master can be gated per buyer. But `vendors` is GC-only (`vendors_select` uses `gc_can(auth.uid(),'view')`), so **a client cannot pick from the vendor roster**, and widening that would expose GC's distribution network to every client.

Resolution adopted here: the client types a **free-text buyer name**; `vendor_id` stays null. When a deal closes, GC attaches the vendor to the link (Task 10). Until then the page works fully except the master, which is exactly the pitch state. This keeps the existing boundary and matches "delivery is manual and GC-run."

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/export-spec.ts` (modify) | Add `title` source kind; fix `STANDARD_EXPORT_TEMPLATE`; add `BUYER_EXPORT_TEMPLATE`. |
| `src/lib/export-engine.ts` (modify) | `TitleExportInput.title`; resolve the `title` source. |
| `src/lib/export-filename.ts` (create) | Slugging and filename construction. Pure, no I/O. |
| `src/app/api/gc/export/route.ts` (modify) | Pass the new `title` field. |
| `supabase/migrations/20260806000200_…sql` (modify) | Recipient columns; recipient-scoped revoke. |
| `src/app/(app)/titles/[id]/buyer-share-control.tsx` (modify) | Buyer-name form. |
| `src/app/(app)/titles/[id]/actions.ts` (modify) | Pass recipient through. |
| `src/lib/buyer-page.ts` (create) | Pure rules: which actions a (title status, licence state) offers. |
| `src/app/portal/[token]/page.tsx` (modify) | Load trailer, artwork, metadata, licence state. |
| `src/app/portal/[token]/title-page.tsx` (create) | The buyer surface. |
| `src/app/api/portal/screener-download/route.ts` (create) | Signed screener download URL. |
| `src/app/api/portal/metadata-export/route.ts` (create) | Streams the XLSX. |

---

### Task 1: Add a `title` column source to the export spec and engine

Fixes a live defect: `STANDARD_EXPORT_TEMPLATE`'s "Title" column reads `alternate_title`, an optional field most titles lack, so it is blank in vendor exports today.

**Files:**
- Modify: `src/lib/export-spec.ts:15-20` (source union), `:44-60` (`STANDARD_EXPORT_TEMPLATE`)
- Modify: `src/lib/export-engine.ts:5-9` (`TitleExportInput`), `:58-64` (source switch)
- Modify: `src/app/api/gc/export/route.ts:90-95`
- Test: `src/lib/export-spec.test.ts`, `src/lib/export-engine.test.ts`

**Interfaces:**
- Produces: `TitleExportInput = { catalogId: string; title: string; metadata: Record<string, unknown>; offer: OfferLine[] }` — `title` is new and **required**; `{ kind: "title" }` as a column source.

- [ ] **Step 1: Write the failing engine test**

In `src/lib/export-engine.test.ts`, extend the `title()` fixture helper with `title: "Film Name"` and add:

```ts
it("resolves the title source from the record, not from metadata", () => {
  const spec: ExportFormatSpec = {
    format: "xlsx",
    columns: [{ header: "Title", source: { kind: "title" } }],
  };
  const { rows } = buildExportRows(spec, [title({ title: "Monarch" })]);
  expect(rows[0][0]).toBe("Monarch");
});

it("does not warn 'blank' for a title source", () => {
  const spec: ExportFormatSpec = {
    format: "xlsx",
    columns: [{ header: "Title", source: { kind: "title" } }],
  };
  const { warnings } = buildExportRows(spec, [title({ title: "Monarch" })]);
  expect(warnings).toHaveLength(0);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm exec vitest run src/lib/export-engine.test.ts`
Expected: FAIL — `kind: "title"` rejected by the type, and the switch has no `title` case.

- [ ] **Step 3: Add the source kind**

In `src/lib/export-spec.ts`, add to the `source` discriminated union:

```ts
  z.object({ kind: z.literal("title") }),
```

- [ ] **Step 4: Resolve it in the engine**

In `src/lib/export-engine.ts`, add `title: string;` to `TitleExportInput`, and add to the switch in `buildExportRows`:

```ts
        case "title": raw = t.title; break;
```

- [ ] **Step 5: Run and verify it passes**

Run: `pnpm exec vitest run src/lib/export-engine.test.ts`
Expected: PASS

- [ ] **Step 6: Point the standard template at the real title**

In `src/lib/export-spec.ts`, in `STANDARD_EXPORT_TEMPLATE.columns`, replace

```ts
    { header: "Title", source: { kind: "field", key: "alternate_title" } },
```

with

```ts
    { header: "Title", source: { kind: "title" } },
    { header: "Alternate Title", source: { kind: "field", key: "alternate_title" } },
```

`alternate_title` stays a field — a film often carries different titles by territory. It simply stops standing in for the title.

- [ ] **Step 7: Fix the GC export caller**

In `src/app/api/gc/export/route.ts` the `inputs` map must supply `title`. Add `title` to the `titles` select if absent, then include `title: t.title ?? ""` in the mapped object.

- [ ] **Step 8: Full verification**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src`
Expected: all pass. Typecheck is the real gate — every `TitleExportInput` construction must now supply `title`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/export-spec.ts src/lib/export-engine.ts src/lib/export-spec.test.ts src/lib/export-engine.test.ts src/app/api/gc/export/route.ts
git commit -m "fix(export): emit the actual title, not the alternate title

STANDARD_EXPORT_TEMPLATE mapped its Title column to alternate_title — an
optional field most titles never fill — so that column shipped blank in
vendor exports. No column source could reach titles.title at all.

Adds { kind: \"title\" } and gives alternate_title its own column."
```

---

### Task 2: Export filename builder

**Files:**
- Create: `src/lib/export-filename.ts`
- Test: `src/lib/export-filename.test.ts`

**Interfaces:**
- Produces: `buildExportFilename(input: { catalogId: string; title: string; date: Date; recipient?: string | null }): string`
- Produces: `slugSegment(raw: string | null | undefined, fallback: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/export-filename.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildExportFilename, slugSegment } from "@/lib/export-filename";

const base = { catalogId: "GC00417", title: "Monarch: Legacy of Monsters", date: new Date("2026-08-06T12:00:00Z") };

describe("buildExportFilename", () => {
  it("orders catalog id, title, date, recipient", () => {
    expect(buildExportFilename({ ...base, recipient: "Tubi" }))
      .toBe("GC00417_monarch-legacy-of-monsters_2026-08-06_tubi.xlsx");
  });

  it("falls back to global_content when there is no recipient", () => {
    expect(buildExportFilename({ ...base, recipient: null }))
      .toBe("GC00417_monarch-legacy-of-monsters_2026-08-06_global_content.xlsx");
  });
});

describe("slugSegment — untrusted input reaches a Content-Disposition header", () => {
  it("strips path separators", () => {
    expect(slugSegment("../../etc/passwd", "fallback")).toBe("etc-passwd");
  });

  it("strips CRLF so a header cannot be split", () => {
    expect(slugSegment("Tubi\r\nX-Evil: 1", "fallback")).toBe("tubi-x-evil-1");
  });

  it("strips quotes", () => {
    expect(slugSegment('Tubi"; rm -rf /', "fallback")).toBe("tubi-rm-rf");
  });

  it("caps length at 60", () => {
    expect(slugSegment("a".repeat(200), "fallback")).toHaveLength(60);
  });

  it("falls back when nothing usable survives", () => {
    expect(slugSegment("///", "global_content")).toBe("global_content");
    expect(slugSegment("", "global_content")).toBe("global_content");
    expect(slugSegment(null, "global_content")).toBe("global_content");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm exec vitest run src/lib/export-filename.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/export-filename.ts`:

```ts
// Filename for a metadata export. The recipient segment names WHICH TEMPLATE the sheet
// follows, which is how the official vendor exports are told apart at a glance.
//
// slugSegment is a security boundary, not tidiness: these segments reach a
// Content-Disposition header, so raw CRLF would let a caller inject headers.
const MAX_SEGMENT = 60;

export function slugSegment(raw: string | null | undefined, fallback: string): string {
  const slug = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // everything else, including / \ " CR LF, becomes a hyphen
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/g, ""); // slicing may have left a trailing hyphen
  return slug || fallback;
}

export function buildExportFilename(input: {
  catalogId: string;
  title: string;
  date: Date;
  recipient?: string | null;
}): string {
  const cat = slugSegment(input.catalogId, "untitled").toUpperCase();
  const title = slugSegment(input.title, "untitled");
  const day = input.date.toISOString().slice(0, 10);
  const recipient = slugSegment(input.recipient, "global_content");
  return `${cat}_${title}_${day}_${recipient}.xlsx`;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm exec vitest run src/lib/export-filename.test.ts`
Expected: PASS. Note `slugSegment("a".repeat(200))` yields exactly 60 characters, and `GC00417` survives uppercasing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-filename.ts src/lib/export-filename.test.ts
git commit -m "feat(export): filename convention with hardened slugging"
```

---

### Task 3: Buyer export template

**Files:**
- Modify: `src/lib/export-spec.ts` (append)
- Test: `src/lib/export-spec.test.ts`

**Interfaces:**
- Produces: `BUYER_EXPORT_TEMPLATE: ExportFormatSpec`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/export-spec.test.ts`:

```ts
describe("BUYER_EXPORT_TEMPLATE", () => {
  it("is a valid spec", () => {
    expect(parseExportSpec(BUYER_EXPORT_TEMPLATE).ok).toBe(true);
  });

  it("omits Offer — a prospect has no offer, and showing rights granted elsewhere would be wrong", () => {
    expect(BUYER_EXPORT_TEMPLATE.columns.some((c) => c.source.kind === "offer")).toBe(false);
  });

  it("leads with the real title", () => {
    expect(BUYER_EXPORT_TEMPLATE.columns[0].source).toEqual({ kind: "title" });
  });
});
```

Add `BUYER_EXPORT_TEMPLATE` to the import at the top of the file.

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm exec vitest run src/lib/export-spec.test.ts`
Expected: FAIL — `BUYER_EXPORT_TEMPLATE` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/export-spec.ts`:

```ts
// Buyer-facing sheet: the standard template minus Offer. A prospective buyer has no offer,
// and listing rights already granted to other endpoints would be actively wrong.
export const BUYER_EXPORT_TEMPLATE: ExportFormatSpec = {
  format: "xlsx",
  sheet_name: "Title",
  columns: [
    { header: "Title", source: { kind: "title" } },
    { header: "Alternate Title", source: { kind: "field", key: "alternate_title" } },
    { header: "Catalog ID", source: { kind: "catalog_id" } },
    { header: "Synopsis", source: { kind: "field", key: "synopsis" } },
    { header: "Runtime (min)", source: { kind: "field", key: "runtime_minutes" } },
    { header: "Year", source: { kind: "field", key: "release_year" } },
    { header: "Genre", source: { kind: "field", key: "genre" } },
    { header: "Language", source: { kind: "field", key: "primary_language" } },
    { header: "Country", source: { kind: "field", key: "country_of_origin" } },
    { header: "Director", source: { kind: "field", key: "director" } },
    { header: "Cast", source: { kind: "field", key: "cast" }, transform: { type: "list_join", delimiter: ", " } },
    { header: "Rating", source: { kind: "field", key: "rating" } },
    { header: "Production Company", source: { kind: "field", key: "production_company" } },
  ],
};
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm exec vitest run src/lib/export-spec.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-spec.ts src/lib/export-spec.test.ts
git commit -m "feat(export): buyer template — standard minus the offer column"
```

---

### Task 4: Recipient on `portal_links`, and recipient-scoped revoke

**This task contains destructive SQL. Show the founder the exact statements and get explicit approval before applying. Do not run `supabase migration up`.**

**Files:**
- Modify: `supabase/migrations/20260806000200_client_screener_share_links.sql`
- Modify: `supabase/tests/screener_test.sql`

**Interfaces:**
- Produces: `portal_links.vendor_id uuid null`, `portal_links.recipient_name text`
- Produces: `create_screener_link(p_title_id uuid, p_token_hash text, p_expires_at timestamptz default null, p_share_token text default null, p_recipient_name text default null)`

**Why this edits an existing migration:** `20260806000200` is written but unapplied, and it currently enforces one active screener link **per title per side**. One link per buyer breaks that — a client pitching five buyers would have four links destroyed on creation. Folding the fix in beats shipping a correction on top of an unapplied file. If it has already been applied, write a new migration instead.

- [ ] **Step 1: Add the columns**

Insert before the `create or replace function public.create_screener_link` block:

```sql
-- Recipient. One share link per BUYER, not per title: a title-scoped link cannot safely
-- offer the master, because the moment any buyer licenses the title every other prospect
-- still holding a link would qualify. vendor_id stays null until GC attaches the vendor at
-- deal time (vendors are GC-only, so a client cannot pick one).
alter table public.portal_links
  add column if not exists vendor_id      uuid references public.vendors(id) on delete restrict,
  add column if not exists recipient_name text;

create index if not exists portal_links_title_recipient_idx
  on public.portal_links (title_id, recipient_name);
```

- [ ] **Step 2: Take the recipient in the RPC**

Change the signature (note `default null` — the gen-types gotcha) and the insert:

```sql
create or replace function public.create_screener_link(
  p_title_id       uuid,
  p_token_hash     text,
  p_expires_at     timestamptz default null,
  p_share_token    text default null,
  p_recipient_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
```

and in the `insert`, add the column and value:

```sql
  insert into public.portal_links
    (purpose, title_id, token_hash, share_token, created_by, expires_at, recipient_name)
  values ('screener_view', p_title_id, btrim(p_token_hash), p_share_token, auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'), nullif(btrim(p_recipient_name), ''))
  returning id into v_id;
```

- [ ] **Step 3: Narrow the revoke to the recipient**

Replace the revoke `update` with:

```sql
  -- Single active link per (title, recipient, side). Replacing Tubi's link must not touch
  -- Roku's, and neither may touch GC's outstanding vendor link.
  update public.portal_links
     set revoked_at = now()
   where title_id = p_title_id
     and purpose = 'screener_view'
     and revoked_at is null
     and public.is_gc_staff(created_by) = v_is_gc
     and recipient_name is not distinct from nullif(btrim(p_recipient_name), '');
```

`is not distinct from` is required, not cosmetic: `null = null` is null, so a plain `=` would never match GC's unnamed links and they would accumulate forever.

- [ ] **Step 4: Update the grant statements**

The argument list changed, so the old 4-arg grants no longer match. Replace both lines:

```sql
revoke execute on function public.create_screener_link(uuid, text, timestamptz, text, text) from public, anon;
grant  execute on function public.create_screener_link(uuid, text, timestamptz, text, text) to authenticated;
```

Add a `drop function if exists public.create_screener_link(uuid, text, timestamptz, text);` immediately before the `create or replace`, or the 4-arg overload survives alongside the 5-arg one. This mirrors the `create_title` pattern already used in this repo.

- [ ] **Step 5: Add pgTAP coverage**

In `supabase/tests/screener_test.sql`, after the existing client-share block, add (and raise `plan(43)` to `plan(46)`):

```sql
-- One link per buyer: replacing one recipient's link must not revoke another's.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_a', 'share_a', 'Tubi'),
  'client creates a link for buyer A');
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_b', 'share_b', 'Roku'),
  'client creates a link for buyer B on the same title');
select is(
  (select revoked_at from public.portal_links where token_hash = 'tok_buyer_a'),
  null, 'buyer B''s link does not revoke buyer A''s');
```

- [ ] **Step 6: Show the founder the SQL and stop**

Print the full diff of the migration. State plainly that it adds two columns, an index, drops and recreates one function, and changes no data. **Do not apply it.** The founder runs `! pnpm exec supabase migration up --local`.

- [ ] **Step 7: After approval and apply — verify**

Run: `pnpm exec supabase test db`
Expected: `screener_test.sql` passes at 46.

Then regenerate types and commit both:

```bash
pnpm exec supabase gen types typescript --local > src/lib/supabase/database.types.ts
git add supabase/migrations supabase/tests src/lib/supabase/database.types.ts
git commit -m "feat(portal): one screener link per buyer

Scopes the single-active-link revoke to (title, recipient, side). A
title-scoped link cannot safely offer the master: once any buyer licenses
the title, every other prospect holding a link would qualify."
```

---

### Task 5: Buyer name in the share control

**Files:**
- Modify: `src/app/(app)/titles/[id]/buyer-share-control.tsx`
- Modify: `src/app/(app)/titles/[id]/actions.ts` (`createBuyerScreenerLink`)
- Modify: `src/app/(app)/titles/[id]/page.tsx` (the share-link query)

**Interfaces:**
- Consumes: `create_screener_link(..., p_recipient_name)` from Task 4.
- Produces: `createBuyerScreenerLink(input: { titleId: string; recipientName: string }): Promise<{ error?: string; url?: string }>`

- [ ] **Step 1: Pass the recipient through the action**

In `actions.ts`, change the signature to accept `recipientName`, reject empty input before the RPC, and pass `p_recipient_name`:

```ts
export async function createBuyerScreenerLink(input: {
  titleId: string;
  recipientName: string;
}): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };
  const recipient = input.recipientName.trim();
  if (!recipient) return { error: "Enter the buyer's name." };

  const token = generateToken();
  const { error } = await supabase.rpc("create_screener_link", {
    p_title_id: input.titleId,
    p_token_hash: hashToken(token),
    p_share_token: token,
    p_recipient_name: recipient,
  });
  if (error) return { error: error.message };

  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath(`/titles/${input.titleId}`);
  return { url: `${base}/portal/${token}` };
}
```

- [ ] **Step 2: Turn the button into a form**

In `buyer-share-control.tsx`, add a controlled `recipient` input above the create button, labelled "Buyer", with helper copy: *"One link per buyer. Naming them lets you see who watched, and releases the master to them once their licence is live."* Disable Create while it is empty. Pass `recipientName: recipient` to the action.

The component currently shows a single active link. It now shows a **list** of active links, one row per buyer: name, truncated URL, Copy, Replace, Stop sharing. Replace and Stop act on that row's `linkId`.

- [ ] **Step 3: Return all active links from the page**

In `page.tsx`, change the share-link query from `.limit(1).maybeSingle()` to a bounded list ordered by `created_at desc`, selecting `id, share_token, expires_at, recipient_name`, and pass the array. Keep it inside the existing `Promise.all`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src`

- [ ] **Step 5: Manual check**

Create links for two different buyers on one approved title. Confirm both stay live and both URLs resolve. Confirm creating a second link for the *same* buyer name revokes only that buyer's previous link.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/titles/[id]"
git commit -m "feat(titles): name the buyer when sharing a screener"
```

---

### Task 6: Buyer page rules

Pure logic, extracted so the page and both API routes agree and so the security-critical decisions are unit-testable without a browser.

**Files:**
- Create: `src/lib/buyer-page.ts`
- Test: `src/lib/buyer-page.test.ts`

**Interfaces:**
- Produces:

```ts
export type BuyerPageState = {
  titleStatus: string | null;
  hasScreenerAsset: boolean;
  hasTrailer: boolean;
  licensed: boolean; // an active grant + delivery for THIS recipient
};
export type BuyerActions = {
  canWatchScreener: boolean;
  canDownloadScreener: boolean;
  canDownloadMaster: boolean;
  canDownloadMetadata: boolean;
};
export function buyerActionsFor(state: BuyerPageState): BuyerActions;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/buyer-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buyerActionsFor, type BuyerPageState } from "@/lib/buyer-page";

const base: BuyerPageState = {
  titleStatus: "in_delivery",
  hasScreenerAsset: true,
  hasTrailer: true,
  licensed: false,
};

describe("buyerActionsFor", () => {
  it("at pitch: watch, screener download and metadata — never the master", () => {
    const a = buyerActionsFor(base);
    expect(a).toEqual({
      canWatchScreener: true,
      canDownloadScreener: true,
      canDownloadMaster: false,
      canDownloadMetadata: true,
    });
  });

  it("releases the master once this recipient is licensed", () => {
    expect(buyerActionsFor({ ...base, licensed: true }).canDownloadMaster).toBe(true);
  });

  it("withholds the screener download before GC approves the title", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "in_review" });
    expect(a.canWatchScreener).toBe(true);
    expect(a.canDownloadScreener).toBe(false);
  });

  it("offers nothing screener-shaped when no screener asset exists", () => {
    const a = buyerActionsFor({ ...base, hasScreenerAsset: false });
    expect(a.canWatchScreener).toBe(false);
    expect(a.canDownloadScreener).toBe(false);
    expect(a.canDownloadMetadata).toBe(true);
  });

  it("still offers metadata on an unapproved title with no assets", () => {
    expect(
      buyerActionsFor({ titleStatus: "draft", hasScreenerAsset: false, hasTrailer: false, licensed: false })
        .canDownloadMetadata,
    ).toBe(true);
  });

  it("fails closed on an unknown status", () => {
    const a = buyerActionsFor({ ...base, titleStatus: "some_future_status" });
    expect(a.canDownloadScreener).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm exec vitest run src/lib/buyer-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/buyer-page.ts`:

```ts
import { isPostApprovalTitleStatus } from "@/lib/assets";

// THE rule set for the buyer portal page. The page and both download routes read this, so a
// button can never render for a request that would be refused — and, more importantly, so the
// master gate is one testable expression rather than three scattered conditionals.
//
// Metadata is always available: it is the pitch material, and a buyer evaluating a title needs
// the specs whether or not a screener has been uploaded yet.
export type BuyerPageState = {
  titleStatus: string | null;
  hasScreenerAsset: boolean;
  hasTrailer: boolean;
  licensed: boolean;
};

export type BuyerActions = {
  canWatchScreener: boolean;
  canDownloadScreener: boolean;
  canDownloadMaster: boolean;
  canDownloadMetadata: boolean;
};

export function buyerActionsFor(state: BuyerPageState): BuyerActions {
  const approved = isPostApprovalTitleStatus(state.titleStatus);
  return {
    canWatchScreener: state.hasScreenerAsset,
    canDownloadScreener: state.hasScreenerAsset && approved,
    // Never inferred from the title alone: licensed means an active grant AND delivery for
    // THIS recipient, resolved server-side.
    canDownloadMaster: state.licensed,
    canDownloadMetadata: true,
  };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm exec vitest run src/lib/buyer-page.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/buyer-page.ts src/lib/buyer-page.test.ts
git commit -m "feat(portal): buyer page action rules"
```

---

### Task 7: Load the page data

**Files:**
- Modify: `src/app/portal/[token]/page.tsx:31-50`

**Interfaces:**
- Consumes: `buyerActionsFor` (Task 6).
- Produces: the `ready` prop for `screener_view` gains `catalogId`, `metadata`, `posterUrl`, `bannerUrl`, `trailerAvailable`, `recipientName`, `actions`.

- [ ] **Step 1: Extend the query**

In the `screener_view` branch, extend the existing `Promise.all` — do not add sequential awaits — to fetch the title row (`title, catalog_id, status, org_id`), the metadata row, the asset list for the title (`kind`), and the licence check. Select `recipient_name, vendor_id` from the link in the outer query.

The licence check, only when `vendor_id` is set:

```ts
admin
  .from("deliveries")
  .select("id")
  .eq("title_id", link.title_id)
  .eq("vendor_id", link.vendor_id)
  .in("status", ["delivered", "live"])
  .limit(1)
  .maybeSingle();
```

Guard with `link.vendor_id ? …query… : Promise.resolve({ data: null })` so an unattached link never queries.

- [ ] **Step 2: Sign the artwork**

Resolve poster and banner keys from the asset list and sign them with `PORTAL.artworkTtlSeconds` — the comment on that constant explains why the download TTL is wrong for an `<img>`.

- [ ] **Step 3: Compute actions server-side**

```ts
// Which asset IS the screener depends on the title's source setting — the same split
// /api/portal/screener already makes.
const screenerKind = titleRow?.screener_source === "dedicated" ? "screener" : "master";
const actions = buyerActionsFor({
  titleStatus: titleRow?.status ?? null,
  hasScreenerAsset: assets.some((a) => a.kind === screenerKind),
  hasTrailer: assets.some((a) => a.kind === "trailer"),
  licensed: Boolean(delivery),
});
```

Add `screener_source` to the title select alongside `title, catalog_id, status, org_id`.
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm exec eslint src`

- [ ] **Step 5: Commit**

```bash
git add "src/app/portal/[token]/page.tsx"
git commit -m "feat(portal): load title, artwork, metadata and licence state"
```

---

### Task 8: The title page component

**Files:**
- Create: `src/app/portal/[token]/title-page.tsx`
- Modify: `src/app/portal/[token]/portal-flow.tsx` (render it in the `ready` branch)

**Interfaces:**
- Consumes: the `ready` prop shape from Task 7.

- [ ] **Step 1: Relax the identity form**

The spec makes **email required, name and company optional**. `portal-flow.tsx` currently marks all three `required`. Remove `required` from the name and company inputs and append " (optional)" to both labels. Leave email and the OTP step untouched. The link already names the buyer, so these fields now identify the *person*, not the company.

- [ ] **Step 2: Build the layout**

Two columns at `lg:` and above, one column below with viewing first — the spec's equal-weight principle. Left: banner hero with poster, title, and a key-facts line (year · runtime · genre · rating); trailer inline, `controls`, no autoplay; screener player appears on Watch. Right: the metadata grid.

**Artwork fallback:** if the banner is missing, the hero falls back to the poster on a token-coloured field; if both are missing, to the title alone. It must never render a broken image or a collapsed hero.

Metadata grid — iterate the canonical registry so the page never holds its own field list:

```tsx
import { METADATA_FIELDS } from "@/lib/metadata";

function MetadataGrid({ data }: { data: Record<string, unknown> }) {
  const rows = METADATA_FIELDS.map((f) => ({ label: f.label, value: data[f.key] }))
    // Omitted, not blanked — a half-filled sheet reads as neglect.
    .filter((r) => r.value !== null && r.value !== undefined && r.value !== ""
                   && !(Array.isArray(r.value) && r.value.length === 0));

  return (
    <dl className="divide-y divide-hairline">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-6 py-2">
          <dt className="t-label text-ink-2">{r.label}</dt>
          <dd className="t-body-sm text-ink text-right tabular-nums">
            {Array.isArray(r.value) ? r.value.join(", ") : String(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

Design tokens only; no hex. Reuse `Card`, `CardBody`, `InlineNotice`, `Dialog` and `Button` from `src/components/ui`.

- [ ] **Step 3: Wire the actions**

Watch, Download screener, Download metadata, and (when `actions.canDownloadMaster`) Download master — visually distinct from the screener so nobody ingests the wrong file. Render each only when its flag is true.

Handle `409` from either download route with `PORTAL_COPY.errorPreparing`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`

- [ ] **Step 5: Manual check**

Open a real share link end to end: identify (leaving name and company blank), verify, page renders, trailer plays, screener plays, metadata reads correctly, empty fields absent, missing banner falls back cleanly.

- [ ] **Step 6: Commit**

```bash
git add "src/app/portal/[token]"
git commit -m "feat(portal): buyer title page"
```

---

### Task 9: Download routes

**Files:**
- Create: `src/app/api/portal/screener-download/route.ts`
- Create: `src/app/api/portal/metadata-export/route.ts`
- Create: `src/app/api/portal/master-download/route.ts`

**Interfaces:**
- Consumes: `buyerActionsFor` (6), `BUYER_EXPORT_TEMPLATE` (3), `buildExportFilename` (2), `buildExportRows` / `toXlsx` (1).

> **Amended 2026-08-06.** The original task listed only two routes. The spec requires the
> master once the recipient's licence is live, and Task 8 correctly wired a Download master
> button to `/api/portal/master-download` — a route this plan never specified. Without Step 3
> that button 404s and the page renders "This link has expired or been withdrawn", which is
> both wrong and alarming for a licensed buyer. The gap was mine, not the implementer's.

- [ ] **Step 1: Screener download route**

Model it on `src/app/api/portal/download/route.ts`. Resolve the session from the `PORTAL.sessionCookie` server-side; re-resolve the link and title; recompute `buyerActionsFor` and **refuse if `canDownloadScreener` is false** — never trust the page. Run `resolveOrRestore` and return 409 on `restoring`. Sign with `PORTAL.signedUrlTtlSeconds`. Write a `download` row to `portal_access_events` **before** returning the URL, and fail closed if the insert fails — the existing master route does exactly this, and the comment there explains why.

- [ ] **Step 2: Metadata export route**

Same session resolution. Then:

```ts
const spec = vendorSpec ?? BUYER_EXPORT_TEMPLATE;
const { headers, rows } = buildExportRows(spec, [{
  catalogId: title.catalog_id ?? "",
  title: title.title,
  metadata: (metaRow?.data ?? {}) as Record<string, unknown>,
  offer: [],
}]);
const buf = await toXlsx(headers, rows, spec.sheet_name ?? "Title");
const filename = buildExportFilename({
  catalogId: title.catalog_id ?? "",
  title: title.title,
  date: new Date(),
  recipient: link.recipient_name,
});
return new Response(new Uint8Array(buf), {
  headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${filename}"`,
  },
});
```

`vendorSpec` is the recipient vendor's `export_format_spec` when the link has a `vendor_id` and that vendor has one — parsed through `parseExportSpec`, falling back to `BUYER_EXPORT_TEMPLATE` if invalid rather than throwing. Log the parse failure.

Write an access event here too.

- [ ] **Step 3: Master download route**

The highest-risk route in this plan — it serves the crown-jewel deliverable to an external party. Model it on the existing `src/app/api/portal/download/route.ts`, which already does this correctly for GC's vendor links, and follow its structure rather than inventing one.

Same session resolution as Steps 1 and 2. Then, in this order:

1. Recompute `buyerActionsFor` server-side and **refuse with 403 unless `canDownloadMaster` is true.** Never trust the page — the button's presence is a rendering decision, this is the authorization.
2. `canDownloadMaster` derives from `licensed`, which must be re-resolved HERE from an active grant and delivery for **this link's `vendor_id` and this title** — not carried in from the client, and not inferred from the title alone. A link with no `vendor_id` can never reach the master.
3. Resolve the master asset for the title, run `resolveOrRestore`, and return 409 on `restoring` so the page shows the cold-storage message.
4. Sign with `PORTAL.signedUrlTtlSeconds` (the single-GET download TTL, not the streaming one).
5. Write a `download` row to `portal_access_events` **before** returning the URL, and **fail closed if that insert fails** — serving an unauditable master is worse than failing. The existing master route does exactly this and its comment explains why; keep that reasoning.

This route is the one place in the plan where a mistake hands an unwatermarked master to the wrong party. Prefer refusing on any ambiguity.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`

- [ ] **Step 5: Manual check**

Download the sheet. Confirm the filename matches the convention, the Title column is populated, there is no Offer column, and the file opens in Excel or Sheets. Separately confirm the master route refuses on a link with no `vendor_id`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/portal
git commit -m "feat(portal): screener, master and metadata downloads for buyers"
```

---

### Task 10: GC attaches a vendor to a buyer link

Without this the master can never appear, because clients cannot see the vendor roster. Small GC-side action closing the loop.

**Files:**
- Modify: `supabase/migrations/20260806000200_client_screener_share_links.sql` (add one RPC)
- Modify: `src/app/(app)/(operator)/gc/titles/[id]/page.tsx`

**Interfaces:**
- Produces: `attach_link_vendor(p_link_id uuid, p_vendor_id uuid)` — `gc_can(auth.uid(),'operate')`.

- [ ] **Step 1: Add the RPC to the migration**

```sql
-- GC attaches the vendor once a deal closes. Clients cannot: vendors are GC-only, and
-- exposing the roster would show every client GC's whole distribution network.
create or replace function public.attach_link_vendor(p_link_id uuid, p_vendor_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and active) then
    raise exception 'Vendor not found or inactive';
  end if;
  update public.portal_links
     set vendor_id = p_vendor_id
   where id = p_link_id and purpose = 'screener_view';
  if not found then raise exception 'Link not found'; end if;
end; $$;

revoke execute on function public.attach_link_vendor(uuid, uuid) from public, anon;
grant  execute on function public.attach_link_vendor(uuid, uuid) to authenticated;
```

- [ ] **Step 2: pgTAP**

Add to `screener_test.sql` (raise the plan by 2): a client calling `attach_link_vendor` throws `Not authorized`; GC succeeds and `vendor_id` is set.

- [ ] **Step 3: GC UI**

On the GC title page, list the title's active buyer links (`recipient_name`, created date, attached vendor) with a vendor select that calls the RPC.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src` then `pnpm exec supabase test db` after the founder applies.

- [ ] **Step 5: Commit**

```bash
git add supabase src/app
git commit -m "feat(gc): attach a vendor to a buyer link"
```

---

## Not in this plan

- **Screener proxy (option B).** Approved separately 2026-08-06. Until it exists the buyer's screener is the master — archives at 90 days, may be a browser-unplayable mezzanine. This page is correct without it; the experience is not reliably good. Needs a scoped amendment to `docs/domain-spec.md` §12.
- **Pre-warming Glacier restores at delivery creation.** Agreed in principle, not specced.
- **Public catalog.** Out of scope; belongs in `globalcontent-web`.
- **PDF sales one-sheet.** Deferred.
