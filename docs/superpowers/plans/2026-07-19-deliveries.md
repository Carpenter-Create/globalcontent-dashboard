# Delivery tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track manual, GC-set delivery of titles to distribution endpoints — a `deliveries` table with in-DB rule-12 + cross-client exclusive-conflict enforcement, a GC master queue, and a client per-vendor read view.

**Architecture:** `deliveries` (title × vendor × territory × grant) is written only through GC-only SECURITY DEFINER RPCs (`create_delivery`, `set_delivery_status`) — direct writes revoked; the RPCs enforce rule 12 (via `can_deliver`-style grant check) and the hard conflict block (reusing `territories_overlap`). A `my_deliveries` SECURITY DEFINER function gives clients their own deliveries + vendor names without loosening vendors' GC-only RLS. The title's "Live" status is a **derived** rollup (≥1 delivery live), and title-status labels are centralized (In review / Submitted / Live).

**Tech Stack:** Supabase Postgres (RLS, SECURITY DEFINER, pgTAP), Next.js App Router (server components + client components + server actions), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-deliveries-design.md`. Domain: `docs/domain-spec.md` §13.
- **Branch:** `feat/deliveries` off `main` (`73fa956`).
- **Migration filename:** `supabase/migrations/20260719000600_deliveries.sql` (sorts after `…000500`).
- **Delivery statuses:** `pending | delivered | live | rejected | taken_down` (manual, GC-set, logged).
- **Title labels (client-facing):** `in_review` → "In review", `in_delivery` → "Submitted"; derived "Live · N of M" once ≥1 delivery is live. Internal enum unchanged.
- **Enforcement is in-RPC** (no trigger): `create_delivery` refuses unless the given grant is active + covers the territory/window (rule 12) AND refuses a same-work cross-org exclusive conflict (reuses `territories_overlap`). Direct writes revoked → RPC is the only write path.
- **`can_deliver` stays call-from-definer** — no re-grant to `authenticated`; `create_delivery` validates the specific grant directly.
- **Client never sees vendors table** — vendor names reach clients only via `my_deliveries` (SECURITY DEFINER, scoped by `member_can`). Client sees only endpoints their title was sent to; clean statuses only.
- **Title "Live" is derived, not stored** — never mutate `title.status` to `live`.
- **Conventions:** UUID/`timestamptz`/`snake_case`; regenerate `database.types.ts` after the migration (strip leaked CLI lines); design tokens (no hex); greyscale errors (D3); TS strict. Optional RPC params get `DEFAULT null` (repo gotcha).
- **Destructive-ops (approved before apply):** create type + table + triggers + functions; revokes. Founder runs the apply (`supabase db reset`) + `gen types`.
- **Out of scope (seams):** restoring/Glacier (E); export mapping + email auto-`delivered` (C/D); revenue↔live mismatch flag; per-platform breakdown-with-vendor-names on title detail (title detail shows the rollup badge; full per-vendor list is `/deliveries`).

---

### Task 1: Migration — `delivery_status`, `deliveries`, RLS, `create_delivery`, `set_delivery_status`, `my_deliveries`

**Files:**
- Create: `supabase/migrations/20260719000600_deliveries.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `titles`, `vendors`, `rights_grants` (+ `exclusive`, `work_id` via titles), `organizations`, `is_gc_staff`, `member_can`, `territories_overlap`, `tg_audit`, `tg_set_updated_at`.
- Produces: enum `delivery_status`; table `deliveries`; `create_delivery(uuid,uuid,uuid,text) returns uuid`; `set_delivery_status(uuid, delivery_status, text) returns void`; `my_deliveries() returns table(...)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260719000600_deliveries.sql
--
-- INTENT: manual delivery tracking (domain-spec §13; design 2026-07-19-deliveries).
-- A delivery = title × vendor × territory × grant. Written ONLY via GC-only
-- SECURITY DEFINER RPCs (direct writes revoked) that enforce rule 12 and the hard
-- cross-client exclusive-conflict block in-RPC (no trigger — RPC is the sole write
-- path). my_deliveries gives clients their own deliveries + vendor names without
-- loosening vendors' GC-only RLS. Status is person-set; audit_log is the provenance.
--
-- DESTRUCTIVE OPS (approved before apply): create type, table, triggers, functions;
-- revokes. Forward-only + idempotent where possible.
-- ============================================================================

do $$ begin
  create type public.delivery_status as enum ('pending','delivered','live','rejected','taken_down');
exception when duplicate_object then null; end $$;

create table if not exists public.deliveries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,
  title_id     uuid not null references public.titles(id)        on delete restrict,
  vendor_id    uuid not null references public.vendors(id)        on delete restrict,
  grant_id     uuid not null references public.rights_grants(id)  on delete restrict,
  territory    text not null,
  status       public.delivery_status not null default 'pending',
  status_note  text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint deliveries_territory_iso_chk check (territory ~ '^[A-Z]{2}$'),
  unique (title_id, vendor_id, territory, grant_id)
);
create index if not exists deliveries_org_idx    on public.deliveries (org_id);
create index if not exists deliveries_title_idx  on public.deliveries (title_id);
create index if not exists deliveries_vendor_idx on public.deliveries (vendor_id);
create index if not exists deliveries_grant_idx  on public.deliveries (grant_id);
create index if not exists deliveries_status_idx on public.deliveries (status);

drop trigger if exists audit_deliveries on public.deliveries;
create trigger audit_deliveries after insert or update or delete on public.deliveries
  for each row execute function public.tg_audit();
drop trigger if exists set_updated_at_deliveries on public.deliveries;
create trigger set_updated_at_deliveries before update on public.deliveries
  for each row execute function public.tg_set_updated_at();

alter table public.deliveries enable row level security;
revoke all on public.deliveries from anon;
revoke insert, update, delete on public.deliveries from authenticated, service_role;  -- RPC-only writes
drop policy if exists deliveries_select on public.deliveries;
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'));

-- ---- create_delivery: rule-12 + hard conflict block, GC-only -----------------
create or replace function public.create_delivery(
  p_title_id uuid, p_vendor_id uuid, p_grant_id uuid, p_territory text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_rt   public.rights_type;
  v_excl boolean;
  v_terr text := upper(btrim(p_territory));
  v_work uuid;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if v_terr !~ '^[A-Z]{2}$' then raise exception 'Territory must be an ISO 3166-1 alpha-2 code'; end if;

  select org_id, work_id into v_org, v_work from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and active) then
    raise exception 'Vendor not found or inactive';
  end if;

  -- Rule 12: the SPECIFIC grant must belong to this title, be active, and cover the
  -- rights/territory/window at now(). Captures its rights_type + exclusivity.
  select rights_type, exclusive into v_rt, v_excl
  from public.rights_grants
  where id = p_grant_id and title_id = p_title_id and effective_to is null
    and (window_start is null or now() >= window_start)
    and (window_end   is null or now() <= window_end)
    and case territory_mode
          when 'world'   then true
          when 'include' then v_terr = any (territories)
          when 'exclude' then not (v_terr = any (territories))
        end;
  if not found then
    raise exception 'No active grant on this title covers % (%s)', v_terr, p_grant_id;
  end if;

  -- Hard cross-client conflict block: same work, another org, same rights_type,
  -- overlapping territory, an exclusive claim involved. Runs as owner (sees all orgs).
  if v_work is not null and exists (
    select 1
    from public.titles t2
    join public.rights_grants g2 on g2.title_id = t2.id and g2.effective_to is null
      and g2.rights_type = v_rt
      and public.territories_overlap('include', array[v_terr], g2.territory_mode, g2.territories)
      and (v_excl or g2.exclusive)
    where t2.work_id = v_work and t2.org_id <> v_org
  ) then
    raise exception 'Blocked: another client holds a conflicting exclusive claim on this work for % in %', v_rt, v_terr;
  end if;

  insert into public.deliveries (org_id, title_id, vendor_id, grant_id, territory, created_by)
  values (v_org, p_title_id, p_vendor_id, p_grant_id, v_terr, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_delivery(uuid, uuid, uuid, text) from public, anon;
grant  execute on function public.create_delivery(uuid, uuid, uuid, text) to authenticated;

-- ---- set_delivery_status: GC advances status, logged -------------------------
create or replace function public.set_delivery_status(
  p_delivery_id uuid, p_status public.delivery_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  update public.deliveries
    set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
end;
$$;
revoke execute on function public.set_delivery_status(uuid, public.delivery_status, text) from public, anon;
grant  execute on function public.set_delivery_status(uuid, public.delivery_status, text) to authenticated;

-- ---- my_deliveries: client's own deliveries + vendor names -------------------
-- SECURITY DEFINER bypasses vendors' GC-only RLS to read vendor NAME, but the
-- member_can filter (auth.uid() = the caller) scopes rows to the caller's orgs, so
-- no cross-tenant leak. GC callers see all orgs (member_can bypass) — fine.
create or replace function public.my_deliveries()
  returns table (delivery_id uuid, title_id uuid, title text, vendor_name text,
                 territory text, status public.delivery_status, updated_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select d.id, d.title_id, t.title, v.name, d.territory, d.status, d.updated_at
  from public.deliveries d
  join public.titles t  on t.id = d.title_id
  join public.vendors v on v.id = d.vendor_id
  where public.member_can(auth.uid(), d.org_id, 'view')
  order by t.title, v.name, d.territory;
$$;
revoke execute on function public.my_deliveries() from public, anon;
grant  execute on function public.my_deliveries() to authenticated;
```

- [ ] **Step 2: Show destructive SQL for approval; founder applies + regenerates**

```
! supabase db reset
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Verify the file starts with `export type Json =`, ends with `} as const`, no leaked CLI lines, and that `deliveries` (Row), `delivery_status`, and the three functions appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719000600_deliveries.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): deliveries — table + RLS + create_delivery (rule 12 + conflict block) + set_delivery_status + my_deliveries"
```

---

### Task 2: pgTAP — creation gates, conflict block, status, tenant isolation, my_deliveries

**Files:**
- Create: `supabase/tests/deliveries_test.sql`

**Interfaces:** Consumes everything from Task 1.

- [ ] **Step 1: Write the test**

```sql
-- deliveries_test.sql
-- create_delivery: GC-only, rule-12 gates, hard exclusive-conflict block; set_delivery_status;
-- tenant isolation; my_deliveries scoping.

begin;
select plan(12);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.org_b', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner, org A
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff
select set_config('t.ta',    gen_random_uuid()::text, false);  -- title A (org A)
select set_config('t.tb',    gen_random_uuid()::text, false);  -- title B (org B, same work)
select set_config('t.ga',    gen_random_uuid()::text, false);  -- grant on A
select set_config('t.vendor',gen_random_uuid()::text, false);
select set_config('t.work',  gen_random_uuid()::text, false);

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.works (id) values (current_setting('t.work')::uuid);
insert into public.titles (id, org_id, title, work_id) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, 'Film', current_setting('t.work')::uuid),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, 'Film', current_setting('t.work')::uuid);
insert into public.vendors (id, name, delivery_mode) values
  (current_setting('t.vendor')::uuid, 'Endpoint One', 'portal_upload');
-- Grant on A: SVOD, include US, NON-exclusive, active.
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.ga')::uuid, current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid,
   'svod','include',array['US'], false, now());

set local role authenticated;

-- ===== client denied =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', 'Not authorized', 'client: create_delivery denied (not gc_staff)');

-- ===== GC: rule-12 gates =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
-- territory outside grant (grant is US; try CA)
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'CA') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', null, 'rule 12: territory outside grant refused');
-- valid create (US, covered)
select lives_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'gc: valid create_delivery (US covered) succeeds');
select is((select count(*) from public.deliveries where title_id = current_setting('t.ta')::uuid)::int,
  1, 'one delivery row created');
select is((select status::text from public.deliveries where title_id = current_setting('t.ta')::uuid),
  'pending', 'new delivery defaults to pending');

-- ===== hard conflict block =====
-- Org B (same work) declares EXCLUSIVE SVOD US → creating A's SVOD-US delivery must now be blocked
-- for a NEW territory pairing. Make A's grant also matter: add an exclusive grant path.
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'svod','include',array['US'], true, now());
-- A already has a non-exclusive SVOD-US grant (t.ga); B is exclusive SVOD-US on the same work →
-- a new delivery for A on SVOD-US must be blocked (exclusive involved on B's side).
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', null, 'hard block: another org exclusive same-work SVOD-US refuses the delivery');

-- non-exclusive coexistence: AVOD CA, both non-exclusive → allowed
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (gen_random_uuid(), current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'avod','include',array['CA'], false, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'avod','include',array['CA'], false, now());
select set_config('t.ga_avod',
  (select id::text from public.rights_grants where title_id = current_setting('t.ta')::uuid and rights_type = 'avod' limit 1), false);
select lives_ok(
  format($$ select public.create_delivery(%L,%L,%L,'CA') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga_avod')),
  'no block: two non-exclusive AVOD-CA claims coexist — delivery allowed');

-- ===== set_delivery_status =====
select set_config('t.dlv', (select id::text from public.deliveries where territory = 'US' and title_id = current_setting('t.ta')::uuid), false);
select lives_ok(
  format($$ select public.set_delivery_status(%L, 'live') $$, current_setting('t.dlv')),
  'gc: set_delivery_status to live succeeds');
select is((select status::text from public.deliveries where id = current_setting('t.dlv')::uuid),
  'live', 'status advanced to live');

-- ===== client: reads own deliveries; set_delivery_status denied; my_deliveries scoped =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.deliveries)::int, 2,
  'client: reads its own org deliveries via RLS (2 rows)');
select throws_ok(
  format($$ select public.set_delivery_status(%L, 'rejected') $$, current_setting('t.dlv')),
  'P0001', 'Not authorized', 'client: set_delivery_status denied');
select is((select count(*) from public.my_deliveries() where vendor_name = 'Endpoint One')::int, 2,
  'client: my_deliveries returns own deliveries + vendor name');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** — `supabase test db` → `deliveries_test.sql ... ok` (12/12) and `All tests successful.` Fix minimally on failure (align `plan(N)` to actual checks; wrap `rights_grants`/`titles`/`vendors`/`works` fixture inserts with `reset role;`/`set local role authenticated;` if RLS blocks them — those tables have no direct-INSERT policy — preserving intent and count).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/deliveries_test.sql
git commit -m "test(db): deliveries — rule-12 gates, hard conflict block, status, tenant isolation, my_deliveries"
```

---

### Task 3: Centralized title-status labels + derived "Live" rollup

**Files:**
- Create: `src/lib/titles.ts`
- Modify: `src/app/(app)/titles/page.tsx`
- Modify: `src/app/(app)/titles/[id]/page.tsx`

**Interfaces:**
- Produces: `TITLE_STATUS_LABELS: Record<TitleStatus, string>`, `titleDisplayStatus(status, liveCount, totalCount): string`.

- [ ] **Step 1: Create `src/lib/titles.ts`** (single source for labels + derived rollup)

```ts
import type { Database } from "@/lib/supabase/database.types";

export type TitleStatus = Database["public"]["Enums"]["title_status"];

// Client-facing title vocabulary (founder-decided): in_review → "In review",
// in_delivery → "Submitted". "Live" is derived (≥1 delivery live), not an enum value.
export const TITLE_STATUS_LABELS: Record<TitleStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  in_delivery: "Submitted",
  live: "Live",
  takedown_requested: "Takedown requested",
  taken_down: "Taken down",
};

// The status a client sees. Once a title is live on ≥1 platform, show the derived
// "Live · N of M platforms" rollup on top of its lifecycle state.
export function titleDisplayStatus(status: TitleStatus, liveCount: number, totalCount: number): string {
  if (liveCount > 0) return `Live · ${liveCount} of ${totalCount} platforms`;
  return TITLE_STATUS_LABELS[status];
}
```

- [ ] **Step 2: Titles list uses the shared labels + per-title live rollup** (`src/app/(app)/titles/page.tsx`)

Delete the local `STATUS_LABELS` map (lines ~15-23) and its `TitleStatus` type import usage; import from the lib. Add a per-title live-count query and use `titleDisplayStatus`. Replace the imports + map with:

```tsx
import { TITLE_STATUS_LABELS, titleDisplayStatus, type TitleStatus } from "@/lib/titles";
```
(remove the old `const STATUS_LABELS` block and the `type TitleStatus = ...` line.)

After the titles query, add live/total delivery counts per title (client reads its own deliveries via RLS):

```tsx
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
```

In the card, replace `{STATUS_LABELS[t.status]}` with:

```tsx
                    {titleDisplayStatus(
                      t.status as TitleStatus,
                      counts.get(t.id)?.live ?? 0,
                      counts.get(t.id)?.total ?? 0,
                    )}
```

- [ ] **Step 3: Title detail uses shared labels + rollup** (`src/app/(app)/titles/[id]/page.tsx`)

Delete the local `TITLE_STATUS_LABELS` map (lines ~16-24); import from the lib:

```tsx
import { TITLE_STATUS_LABELS, titleDisplayStatus, type TitleStatus } from "@/lib/titles";
```

After the title query, fetch this title's delivery counts:

```tsx
  const { data: titleDlv } = await supabase
    .from("deliveries")
    .select("status")
    .eq("title_id", id);
  const liveCount = (titleDlv ?? []).filter((d) => d.status === "live").length;
  const totalCount = (titleDlv ?? []).length;
```

Replace the status render (line ~120) with the derived display:

```tsx
          Status: <span className="font-medium text-ink">
            {titleDisplayStatus(title.status as TitleStatus, liveCount, totalCount)}
          </span>
```

- [ ] **Step 4: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/titles.ts src/app/\(app\)/titles
git commit -m "feat(titles): centralize status labels (In review/Submitted) + derived Live rollup"
```

---

### Task 4: GC master delivery queue (`/gc/deliveries`)

**Files:**
- Create: `src/app/gc/deliveries/actions.ts`
- Create: `src/app/gc/deliveries/delivery-controls.tsx`
- Create: `src/app/gc/deliveries/page.tsx`
- Modify: `src/app/gc/layout.tsx` (add Deliveries to the GC nav)

**Interfaces:**
- Consumes: `deliveries`, `create_delivery`, `set_delivery_status` (Task 1); `RIGHTS_META`.
- Produces: server actions `createDelivery(input)` and `setDeliveryStatus(deliveryId, status, note?)`.

- [ ] **Step 1: `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type DeliveryStatus = Database["public"]["Enums"]["delivery_status"];

export async function createDelivery(input: {
  titleId: string;
  vendorId: string;
  grantId: string;
  territory: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("create_delivery", {
    p_title_id: input.titleId,
    p_vendor_id: input.vendorId,
    p_grant_id: input.grantId,
    p_territory: input.territory,
  });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}

export async function setDeliveryStatus(
  deliveryId: string,
  status: DeliveryStatus,
  note?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("set_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: status,
    p_note: note && note.trim() ? note.trim() : undefined,
  });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}
```

- [ ] **Step 2: `delivery-controls.tsx`** (client: advance a delivery's status)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { InlineNotice } from "@/components/ui/inline-notice";
import { setDeliveryStatus } from "./actions";
import type { Database } from "@/lib/supabase/database.types";

type DeliveryStatus = Database["public"]["Enums"]["delivery_status"];
const STATUSES: DeliveryStatus[] = ["pending", "delivered", "live", "rejected", "taken_down"];
const LABELS: Record<DeliveryStatus, string> = {
  pending: "Pending", delivered: "Delivered", live: "Live", rejected: "Rejected", taken_down: "Taken down",
};

export function DeliveryControls({ deliveryId, status }: { deliveryId: string; status: DeliveryStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(next: DeliveryStatus) {
    if (next === status) return;
    setBusy(true);
    setError("");
    const res = await setDeliveryStatus(deliveryId, next);
    if (res?.error) { setError(res.error); setBusy(false); return; }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={status}
        disabled={busy}
        onChange={(e) => change(e.target.value as DeliveryStatus)}
        className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
      </select>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
```

- [ ] **Step 3: `page.tsx`** (GC master queue: list all + a create form)

```tsx
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { DeliveryControls } from "./delivery-controls";
import { NewDeliveryForm } from "./new-delivery-form";

export default async function GcDeliveriesPage() {
  const supabase = await createClient();
  const { data: deliveries } = await supabase
    .from("deliveries")
    .select("id, territory, status, titles(title, catalog_id), vendors(name), organizations(name)")
    .order("created_at", { ascending: false });
  const list = deliveries ?? [];

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Deliveries</h1>
      <p className="t-body-sm text-ink-3 pb-6">Placements across all clients. Status is set by hand.</p>

      <div className="mb-8 max-w-xl">
        <NewDeliveryForm />
      </div>

      {list.length === 0 ? (
        <Card><CardBody><p className="t-body-sm text-ink-3">No deliveries yet.</p></CardBody></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((d) => (
            <Card key={d.id}>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{d.titles?.title ?? "—"}</span>
                  <span className="t-body-sm text-ink-3">
                    {d.titles?.catalog_id} · {d.vendors?.name} · {d.territory} · {d.organizations?.name}
                  </span>
                </div>
                <DeliveryControls deliveryId={d.id} status={d.status} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: `new-delivery-form.tsx`** (client: create a delivery)

The form needs a title, vendor, grant, and territory. To keep it operable, load the option data server-side and pass it in. Create `src/app/gc/deliveries/new-delivery-form.tsx` as a client component that takes `titles`, `vendors`, and a per-title grant list; on submit calls `createDelivery`. Since grants depend on the chosen title, pass a `grantsByTitle` map.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createDelivery } from "./actions";

export type GrantOpt = { id: string; label: string };
export function NewDeliveryForm({
  titles, vendors, grantsByTitle,
}: {
  titles: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  grantsByTitle: Record<string, GrantOpt[]>;
}) {
  const router = useRouter();
  const [titleId, setTitleId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [grantId, setGrantId] = useState("");
  const [territory, setTerritory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const grants = titleId ? grantsByTitle[titleId] ?? [] : [];
  const sel = "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleId || !vendorId || !grantId || !territory.trim()) {
      setError("Pick a title, vendor, grant, and territory.");
      return;
    }
    setBusy(true); setError("");
    const res = await createDelivery({ titleId, vendorId, grantId, territory: territory.trim().toUpperCase() });
    if (res?.error) { setError(res.error); setBusy(false); return; }
    setTitleId(""); setVendorId(""); setGrantId(""); setTerritory("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <span className="t-body font-medium text-ink">New delivery</span>
      <select value={titleId} onChange={(e) => { setTitleId(e.target.value); setGrantId(""); }} className={sel}>
        <option value="">Select title…</option>
        {titles.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={sel}>
        <option value="">Select vendor…</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <select value={grantId} onChange={(e) => setGrantId(e.target.value)} className={sel} disabled={!titleId}>
        <option value="">Select grant…</option>
        {grants.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
      <Input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="Territory ISO code (e.g. US)" />
      <Button type="submit" disabled={busy} className="self-start">{busy ? "Creating…" : "Create delivery"}</Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

Wire the option data in `page.tsx` — add before the return, and pass to `<NewDeliveryForm>`:

```tsx
  const { data: titleRows } = await supabase
    .from("titles").select("id, title, catalog_id").order("title");
  const { data: vendorRows } = await supabase
    .from("vendors").select("id, name").eq("active", true).order("name");
  const { data: grantRows } = await supabase
    .from("rights_grants").select("id, title_id, rights_type, territory_mode, territories").is("effective_to", null);
  const titleOpts = (titleRows ?? []).map((t) => ({ id: t.id, label: `${t.catalog_id} · ${t.title}` }));
  const vendorOpts = (vendorRows ?? []).map((v) => ({ id: v.id, name: v.name }));
  const grantsByTitle: Record<string, { id: string; label: string }[]> = {};
  for (const g of grantRows ?? []) {
    (grantsByTitle[g.title_id] ??= []).push({
      id: g.id,
      label: `${g.rights_type} · ${g.territory_mode}${g.territories?.length ? " " + g.territories.join(",") : ""}`,
    });
  }
```
and change the form usage to `<NewDeliveryForm titles={titleOpts} vendors={vendorOpts} grantsByTitle={grantsByTitle} />`.

- [ ] **Step 5: Add Deliveries to the GC nav** (`src/app/gc/layout.tsx`)

In the `<nav>` block, after the Vendors link, add:

```tsx
            <Link href="/gc/deliveries" className="t-body-sm text-ink-2 hover:text-ink">Deliveries</Link>
```

- [ ] **Step 6: Typecheck + lint + build** — green; `/gc/deliveries` appears as a route.

- [ ] **Step 7: Commit**

```bash
git add src/app/gc/deliveries src/app/gc/layout.tsx
git commit -m "feat(deliveries): GC master queue — create + advance status (rule-12 + conflict enforced)"
```

---

### Task 5: Client per-vendor view + verify

**Files:**
- Modify: `src/app/(app)/deliveries/page.tsx` (replace placeholder)

**Interfaces:** Consumes `my_deliveries` (Task 1).

- [ ] **Step 1: Replace the `/deliveries` placeholder with the client view**

```tsx
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", delivered: "Delivered", live: "Live", rejected: "Rejected", taken_down: "Taken down",
};

export default async function DeliveriesPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_deliveries");
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Deliveries" subtitle="Where your titles are placed and their status." />
      {rows.length === 0 ? (
        <Card><CardBody><p className="t-body-sm text-ink-3">No deliveries yet.</p></CardBody></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((d) => (
            <Card key={d.delivery_id}>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{d.title}</span>
                  <span className="t-body-sm text-ink-3">{d.vendor_name} · {d.territory}</span>
                </div>
                <span className="shrink-0 t-body-sm text-ink-2">{STATUS_LABELS[d.status] ?? d.status}</span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build** — green.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/deliveries/page.tsx
git commit -m "feat(deliveries): client per-vendor read view (my_deliveries)"
```

- [ ] **Step 4: Verify end-to-end**
  - Full DB suite — `supabase test db` → `All tests successful.` (incl. `deliveries_test.sql`).
  - App checks — `npm run typecheck && npm run lint && npm run build` → green.
  - Leak-check — invoke the `leak-check` skill (confirm clean).
  - Manual (founder, GC + client): as GC on `/gc/deliveries`, create a delivery (title → vendor → grant → territory); advance it Pending→Delivered→Live; a territory outside the grant is refused; a cross-client exclusive same-work conflict is refused. As the client, `/deliveries` shows the placement + status; the title detail shows "Live · N of M platforms" once one is live; the client never sees another org's deliveries.

---

## Self-Review

**1. Spec coverage:** `delivery_status` enum + `deliveries` table + RLS (both-read, RPC-only writes) → Task 1 ✓. `create_delivery` rule-12 + hard conflict block (reuses `territories_overlap`) → Task 1 ✓ (tested Task 2). `set_delivery_status` GC-only → Task 1/2 ✓. `my_deliveries` (vendor names, scoped) → Task 1/2 ✓. Centralized title labels (In review/Submitted) + derived Live rollup → Task 3 ✓. GC master queue → Task 4 ✓. Client view → Task 5 ✓. Seams (restoring, export/email, revenue flag, title.status mutation) → excluded ✓.

**2. Placeholder scan:** No TBD/TODO. Full SQL (enum, table, RLS, 3 functions), full pgTAP (12), full lib + 2 UI surfaces + nav. `create_delivery`'s conflict block uses `territories_overlap('include', array[territory], ...)` to test the single delivery territory against the other grant's scope.

**3. Type consistency:** RPC arg names (`p_title_id`/`p_vendor_id`/`p_grant_id`/`p_territory`; `p_delivery_id`/`p_status`/`p_note`) match the action calls (Task 4). `my_deliveries` return columns (`delivery_id/title_id/title/vendor_name/territory/status/updated_at`) match the client view (Task 5). `titleDisplayStatus(status, liveCount, totalCount)` signature consistent across Tasks 3 surfaces. `DeliveryStatus` enum values consistent across DB, controls, labels. Nested selects (`titles(...)`, `vendors(...)`, `organizations(...)`) rely on the FKs declared in Task 1.
