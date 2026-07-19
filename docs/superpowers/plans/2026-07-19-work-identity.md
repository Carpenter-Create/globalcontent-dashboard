# Work identity + same-work conflict warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let GC link two titles as the same underlying work and see a computed, GC-only warning when linked titles hold conflicting exclusive rights — plus show catalog ID, rights, and same-work suggestions on `/gc/review`.

**Architecture:** A `works` table + nullable `titles.work_id` (GC-write-only via a SECURITY DEFINER RPC). A pure `territories_overlap` helper is the single overlap truth (reused by B-del). Two `SECURITY INVOKER` functions — `same_work_conflicts` (the warning) and `suggest_same_work` (link candidates) — run under the caller's RLS, so they return cross-org data for GC and fail closed for clients. The `/gc/review` card is overhauled to show catalog ID + rights/exclusivity + suggestions (with a link action) + the conflict warning.

**Tech Stack:** Supabase Postgres (RLS, SECURITY DEFINER + INVOKER functions, pgTAP), Next.js App Router (server component + client component + server action), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-work-identity-design.md`. Domain: `docs/domain-spec.md` §9/§13.
- **Branch:** `feat/work-identity` off `main` (`b4e9871`, includes vendors + exclusivity + catalog-id).
- **Migration filename:** `supabase/migrations/20260719000500_work_identity.sql` (sorts after `…000400`).
- **Conflict rule (exact):** for the same work, two grants on **different orgs' titles** conflict iff `rights_type` equal AND `territories_overlap` AND (`a.exclusive OR b.exclusive`), both grants active (`effective_to is null`). Two non-exclusive overlaps do **not** conflict.
- **Warning is GC-only, computed, not stored, not dismissible.** Never render it on a client page (it names another client's claim — cross-tenant leak). Auto-clears when grants/link change (it's derived).
- **`works` is GC-only** (RLS `is_gc_staff` for select/insert/update; no delete). **`titles.work_id` write path is the RPC only** — `titles` has no client UPDATE policy, so no extra column guard is needed (confirm this in Task 1).
- **`territories_overlap` is the single overlap definition** — B-del imports it; do not re-implement overlap anywhere.
- **Detection/suggestions = `SECURITY INVOKER` functions** (respect caller RLS; cross-org for GC, empty for clients).
- **Conventions:** UUID/`timestamptz`/`snake_case`; regenerate `database.types.ts` after the migration (strip leaked CLI lines); design tokens (no hex); greyscale errors (D3); TS strict.
- **Destructive-ops (approved before apply):** create table + triggers + functions; alter table add column; revokes. Founder runs the apply (`supabase db reset`) + `gen types`.
- **Out of scope (seams):** hard delivery block (B-del reuses `territories_overlap` + `same_work_conflicts`); persistent findings store; client-facing conflict messaging; canonical-ID matching; merging two pre-existing works.

---

### Task 1: Migration — `works`, `titles.work_id`, `territories_overlap`, link RPC, detection + suggestion functions

**Files:**
- Create: `supabase/migrations/20260719000500_work_identity.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `titles`, `rights_grants`, `organizations`, `title_metadata`, `is_gc_staff`, `tg_audit`, `tg_set_updated_at`, `territory_mode`, `rights_type`.
- Produces: table `works`; `titles.work_id`; `territories_overlap(territory_mode, text[], territory_mode, text[]) returns boolean`; `link_title_to_work_of(uuid, uuid) returns uuid`; `same_work_conflicts(uuid) returns table(...)`; `suggest_same_work(uuid) returns table(...)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260719000500_work_identity.sql
--
-- INTENT: work identity (link same-work titles) + the same-work exclusive-conflict
-- warning primitives (design 2026-07-19-work-identity). works is GC-only; titles
-- gains a nullable work_id (GC-write-only — titles has no client UPDATE policy, so
-- the SECURITY DEFINER link RPC is its sole writer). territories_overlap is the one
-- overlap truth (B-del reuses it). same_work_conflicts / suggest_same_work are
-- SECURITY INVOKER: they run under the caller's RLS, so GC (is_gc_staff bypass)
-- sees all orgs while a client sees only their own (cross-tenant safe, fails closed).
--
-- DESTRUCTIVE OPS (approved before apply): create table, triggers, functions;
-- alter table add column; revokes. Forward-only + idempotent where possible.
-- ============================================================================

-- ---- works (GC-administered grouping of same-work titles) -------------------
create table if not exists public.works (
  id         uuid primary key default gen_random_uuid(),
  label      text,                                   -- optional GC reference name (slice C market-metadata hangs here)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists audit_works on public.works;
create trigger audit_works after insert or update or delete on public.works
  for each row execute function public.tg_audit();
drop trigger if exists set_updated_at_works on public.works;
create trigger set_updated_at_works before update on public.works
  for each row execute function public.tg_set_updated_at();

alter table public.works enable row level security;
revoke all on public.works from anon;
-- RPC-only write path (SECURITY DEFINER runs as owner, unaffected by this revoke).
revoke insert, update, delete on public.works from authenticated, service_role;

drop policy if exists works_select on public.works;
create policy works_select on public.works for select to authenticated
  using (public.is_gc_staff(auth.uid()));
-- No insert/update/delete policies + revoked DML: only the SECURITY DEFINER RPC writes.

-- ---- titles.work_id (nullable; GC-write-only via the RPC) -------------------
alter table public.titles add column if not exists work_id uuid references public.works(id);
create index if not exists titles_work_idx on public.titles (work_id);

-- ---- territories_overlap: the single overlap truth (world/include/exclude) --
create or replace function public.territories_overlap(
  p_mode_a public.territory_mode, p_terr_a text[],
  p_mode_b public.territory_mode, p_terr_b text[]
) returns boolean language sql immutable as $$
  select case
    when p_mode_a = 'world' or p_mode_b = 'world' then true
    when p_mode_a = 'include' and p_mode_b = 'include' then p_terr_a && p_terr_b
    when p_mode_a = 'include' and p_mode_b = 'exclude' then
      exists (select 1 from unnest(p_terr_a) a where a <> all(p_terr_b))
    when p_mode_a = 'exclude' and p_mode_b = 'include' then
      exists (select 1 from unnest(p_terr_b) b where b <> all(p_terr_a))
    when p_mode_a = 'exclude' and p_mode_b = 'exclude' then true
    else false
  end;
$$;

-- ---- link_title_to_work_of: GC assigns a title to the target's work ---------
create or replace function public.link_title_to_work_of(p_title_id uuid, p_target_title_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_work uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if p_title_id = p_target_title_id then raise exception 'A title cannot be linked to itself'; end if;
  if not exists (select 1 from public.titles where id = p_title_id) then raise exception 'Title not found'; end if;
  select work_id into v_work from public.titles where id = p_target_title_id;
  if not found then raise exception 'Target title not found'; end if;
  if v_work is null then
    insert into public.works (created_by) values (auth.uid()) returning id into v_work;
    update public.titles set work_id = v_work where id = p_target_title_id;
  end if;
  update public.titles set work_id = v_work where id = p_title_id;
  return v_work;
end;
$$;
revoke execute on function public.link_title_to_work_of(uuid, uuid) from public, anon;
grant  execute on function public.link_title_to_work_of(uuid, uuid) to authenticated;

-- ---- same_work_conflicts: the computed warning (SECURITY INVOKER) -----------
-- For a linked title, the active grants on OTHER orgs' titles in the same work
-- that share rights_type, overlap territory, and involve an exclusive claim.
create or replace function public.same_work_conflicts(p_title_id uuid)
  returns table (other_org_name text, other_title text, other_title_id uuid, rights_type public.rights_type)
  language sql stable security invoker set search_path = public as $$
  select distinct o.name, t2.title, t2.id, g1.rights_type
  from public.titles t1
  join public.rights_grants g1 on g1.title_id = t1.id and g1.effective_to is null
  join public.titles t2
    on t2.work_id = t1.work_id and t2.id <> t1.id and t2.org_id <> t1.org_id
  join public.rights_grants g2
    on g2.title_id = t2.id and g2.effective_to is null
   and g2.rights_type = g1.rights_type
   and public.territories_overlap(g1.territory_mode, g1.territories, g2.territory_mode, g2.territories)
   and (g1.exclusive or g2.exclusive)
  join public.organizations o on o.id = t2.org_id
  where t1.id = p_title_id and t1.work_id is not null;
$$;
revoke execute on function public.same_work_conflicts(uuid) from public, anon;
grant  execute on function public.same_work_conflicts(uuid) to authenticated;

-- ---- suggest_same_work: candidate same-work titles (SECURITY INVOKER) -------
-- Other orgs' UNLINKED titles whose normalized name matches and whose release_year
-- agrees (or is unknown on either side). GC-only in practice (RLS scopes it).
create or replace function public.suggest_same_work(p_title_id uuid)
  returns table (title_id uuid, title text, org_name text, release_year text)
  language sql stable security invoker set search_path = public as $$
  with me as (
    select t.id, t.org_id,
           lower(regexp_replace(t.title, '[^a-zA-Z0-9]', '', 'g')) as norm,
           (m.data->>'release_year') as yr
    from public.titles t
    left join public.title_metadata m on m.title_id = t.id
    where t.id = p_title_id
  )
  select t2.id, t2.title, o.name, (m2.data->>'release_year')
  from me
  join public.titles t2
    on t2.id <> me.id and t2.org_id <> me.org_id and t2.work_id is null
   and lower(regexp_replace(t2.title, '[^a-zA-Z0-9]', '', 'g')) = me.norm
  left join public.title_metadata m2 on m2.title_id = t2.id
  join public.organizations o on o.id = t2.org_id
  where me.yr is null or (m2.data->>'release_year') is null or (m2.data->>'release_year') = me.yr
  order by (case when (m2.data->>'release_year') = me.yr then 0 else 1 end), t2.title
  limit 10;
$$;
revoke execute on function public.suggest_same_work(uuid) from public, anon;
grant  execute on function public.suggest_same_work(uuid) to authenticated;
```

- [ ] **Step 2: Show destructive SQL (table + triggers + functions + add column + revokes) for approval; founder applies + regenerates**

```
! supabase db reset
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then strip any leaked CLI lines; verify the file starts with `export type Json =`, ends with `} as const`, and that `works` (Row), `titles.work_id`, and the four functions (`territories_overlap`, `link_title_to_work_of`, `same_work_conflicts`, `suggest_same_work`) appear.

- [ ] **Step 3: Confirm the `work_id` write path is closed** — grep confirms `titles` has no client UPDATE policy (only `titles_select`), so `work_id` is unwritable except through the SECURITY DEFINER RPC. Record this in the commit body.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260719000500_work_identity.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): work identity — works, titles.work_id, territories_overlap, link + conflict/suggest fns"
```

---

### Task 2: pgTAP — overlap truth table, link RPC, conflict detection, suggestions

**Files:**
- Create: `supabase/tests/work_identity_test.sql`

**Interfaces:**
- Consumes: everything from Task 1.

- [ ] **Step 1: Write the test**

```sql
-- work_identity_test.sql
-- territories_overlap truth table; link RPC (GC + client denial); same_work_conflicts
-- (exclusive overlap flagged; non-exclusive pair not; wrong type not; non-overlap not;
-- cross-org; only when linked); suggest_same_work (title+year match, unlinked, cross-org).

begin;
select plan(16);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.org_b', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner, org A
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff
select set_config('t.ta',    gen_random_uuid()::text, false);  -- title, org A
select set_config('t.tb',    gen_random_uuid()::text, false);  -- title, org B (same work)

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, 'Same Film'),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, 'Same Film');
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, '{"release_year":"2024"}'::jsonb),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, '{"release_year":"2024"}'::jsonb);

-- ===== territories_overlap truth table =====
select ok(public.territories_overlap('world','{}','include',array['US']), 'overlap: world × include');
select ok(public.territories_overlap('include',array['US','CA'],'include',array['CA']), 'overlap: include ∩ include');
select ok(not public.territories_overlap('include',array['US'],'include',array['CA']), 'no overlap: disjoint includes');
select ok(public.territories_overlap('include',array['US'],'exclude',array['GB']), 'overlap: include US vs exclude GB');
select ok(not public.territories_overlap('include',array['GB'],'exclude',array['GB']), 'no overlap: include GB vs exclude GB');
select ok(public.territories_overlap('exclude',array['US'],'exclude',array['CA']), 'overlap: exclude × exclude');

-- ===== link RPC: client denied, GC links (creates a shared work) =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.link_title_to_work_of(%L, %L) $$, current_setting('t.ta'), current_setting('t.tb')),
  'P0001', 'Not authorized', 'client: link denied (not gc_staff)');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.link_title_to_work_of(%L, %L) $$, current_setting('t.ta'), current_setting('t.tb')),
  'gc: link succeeds');
select is(
  (select count(distinct work_id)::int from public.titles
    where id in (current_setting('t.ta')::uuid, current_setting('t.tb')::uuid) and work_id is not null),
  1, 'both titles now share one work');

-- ===== same_work_conflicts (as GC) =====
-- A: SVOD US exclusive; B: SVOD US non-exclusive → conflict (exclusive involved)
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'svod','include',array['US'], true, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'svod','include',array['US'], false, now());
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid))::int,
  1, 'conflict: exclusive SVOD-US overlaps another org (flagged)');

-- add a non-exclusive-only pair on a different right/territory that must NOT flag:
-- AVOD CA non-exclusive on A; AVOD CA non-exclusive on B → both non-exclusive → no conflict
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'avod','include',array['CA'], false, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'avod','include',array['CA'], false, now());
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'avod')::int,
  0, 'no conflict: two non-exclusive AVOD-CA claims coexist');

-- wrong rights_type does not conflict: A tvod US exclusive, B has no tvod
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'tvod','include',array['US'], true, now());
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'tvod')::int,
  0, 'no conflict: exclusive right with no matching other-org grant');

-- non-overlapping territory does not conflict: A fast GB exclusive, B fast US exclusive
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'fast','include',array['GB'], true, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'fast','include',array['US'], true, now());
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'fast')::int,
  0, 'no conflict: same exclusive right, disjoint territories');

-- ===== client sees no cross-org conflict (RLS fails closed) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid))::int,
  0, 'client: same_work_conflicts returns nothing (RLS scopes out other orgs)');

-- ===== suggestions (as GC): an unlinked same-name+year title in another org =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select set_config('t.tc', gen_random_uuid()::text, false);
reset role;
insert into public.titles (id, org_id, title) values
  (current_setting('t.tc')::uuid, current_setting('t.org_b')::uuid, 'same film');  -- unlinked, org B
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.tc')::uuid, current_setting('t.org_b')::uuid, '{"release_year":"2024"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.suggest_same_work(current_setting('t.ta')::uuid)
           where title_id = current_setting('t.tc')::uuid)::int,
  1, 'suggest: unlinked same-name+year title in another org is surfaced');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** — `supabase test db` → `work_identity_test.sql ... ok` (16/16) and `All tests successful.` If a count assertion is off, read the failure and fix the SQL or the fixture — do not delete an assertion.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/work_identity_test.sql
git commit -m "test(db): work identity — overlap truth table, link RPC, conflict detection, suggestions"
```

---

### Task 3: `/gc/review` overhaul — catalog ID, rights, suggestions + link, conflict warning

**Files:**
- Modify: `src/app/gc/review/page.tsx`
- Create: `src/app/gc/review/link-controls.tsx`
- Modify: `src/app/gc/review/actions.ts` (add `linkTitleToWork`)

**Interfaces:**
- Consumes: `same_work_conflicts`, `suggest_same_work`, `link_title_to_work_of` (Task 1); `titles.catalog_id`/`work_id`; `rights_grants`; `RIGHTS_META`, `describeTerritory`.
- Produces: server action `linkTitleToWork(titleId, targetTitleId): Promise<{ error?: string }>`.

- [ ] **Step 1: Add the `linkTitleToWork` server action** (`src/app/gc/review/actions.ts`, append)

```ts
// GC links a title to the same work as another title. Gated at the DB by
// link_title_to_work_of (is_gc_staff); the (gc) layout also blocks non-GC users.
export async function linkTitleToWork(
  titleId: string,
  targetTitleId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("link_title_to_work_of", {
    p_title_id: titleId,
    p_target_title_id: targetTitleId,
  });
  if (error) return { error: error.message };

  revalidatePath("/gc/review");
  return {};
}
```

- [ ] **Step 2: Create the link client component** (`src/app/gc/review/link-controls.tsx`)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { linkTitleToWork } from "./actions";

export type Suggestion = { title_id: string; title: string; org_name: string; release_year: string | null };

export function LinkControls({ titleId, suggestions }: { titleId: string; suggestions: Suggestion[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (suggestions.length === 0) return null;

  async function link(targetTitleId: string) {
    setBusy(true);
    setError("");
    const res = await linkTitleToWork(titleId, targetTitleId);
    if (res?.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-hairline bg-surface-muted p-3">
      <span className="t-body-sm font-medium text-ink-2">Possible same-work matches</span>
      {suggestions.map((s) => (
        <div key={s.title_id} className="flex items-center justify-between gap-3">
          <span className="t-body-sm text-ink-2">
            {s.title} · {s.org_name}
            {s.release_year ? ` · ${s.release_year}` : ""}
          </span>
          <Button variant="secondary" onClick={() => link(s.title_id)} disabled={busy} className="shrink-0">
            Link as same work
          </Button>
        </div>
      ))}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
```

- [ ] **Step 3: Overhaul the review page** (`src/app/gc/review/page.tsx`) — full replacement

```tsx
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { ReviewControls } from "./review-controls";
import { LinkControls, type Suggestion } from "./link-controls";

// The GC review queue: every title in_review across all orgs (RLS lets GC read all
// via member_can's is_gc_staff bypass). Chain-of-title check + rights verification +
// same-work linking, with a GC-only exclusive-conflict warning (§9). The conflict
// warning is computed on read and never shown to clients.
export default async function GcReviewPage() {
  const supabase = await createClient();
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, catalog_id, created_at, organizations(name)")
    .eq("status", "in_review")
    .order("created_at", { ascending: true });

  const list = titles ?? [];
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

  // Per-title: grants (own), same-work suggestions, and computed conflicts.
  const detail = await Promise.all(
    list.map(async (t) => {
      const [{ data: grants }, { data: suggestions }, { data: conflicts }] = await Promise.all([
        supabase
          .from("rights_grants")
          .select("id, rights_type, territory_mode, territories, exclusive")
          .eq("title_id", t.id)
          .is("effective_to", null)
          .order("rights_type", { ascending: true }),
        supabase.rpc("suggest_same_work", { p_title_id: t.id }),
        supabase.rpc("same_work_conflicts", { p_title_id: t.id }),
      ]);
      return {
        grants: grants ?? [],
        suggestions: (suggestions ?? []) as Suggestion[],
        conflicts: conflicts ?? [],
      };
    }),
  );

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">In review</h1>
      <p className="t-body-sm text-ink-3 pb-6">
        Confirm chain of title and rights. Link same-work submissions; exclusive conflicts are flagged.
      </p>
      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">Nothing awaiting review.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((t, i) => {
            const d = detail[i];
            return (
              <Card key={t.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">{t.title}</span>
                    <span className="t-body-sm text-ink-3">
                      {t.catalog_id} · {t.organizations?.name ?? "—"} · added {fmt.format(new Date(t.created_at))}
                    </span>
                  </div>

                  {d.grants.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {d.grants.map((g) => (
                        <div key={g.id} className="flex items-center justify-between gap-4">
                          <span className="t-body-sm text-ink-2">
                            {RIGHTS_META[g.rights_type].label} · {g.exclusive ? "Exclusive" : "Non-exclusive"}
                          </span>
                          <span className="shrink-0 t-body-sm text-ink-3">
                            {describeTerritory(g.territory_mode, g.territories)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="t-body-sm text-ink-3">No rights declared.</span>
                  )}

                  {d.conflicts.length > 0 ? (
                    <InlineNotice tone="error">
                      Exclusive rights conflict on the same work:{" "}
                      {d.conflicts
                        .map((c) => `${RIGHTS_META[c.rights_type].label} — ${c.other_title} (${c.other_org_name})`)
                        .join("; ")}
                    </InlineNotice>
                  ) : null}

                  <LinkControls titleId={t.id} suggestions={d.suggestions} />
                  <ReviewControls titleId={t.id} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green. (The `same_work_conflicts`/`suggest_same_work` RPCs return typed rows via the regenerated types.)

- [ ] **Step 5: Commit**

```bash
git add src/app/gc/review
git commit -m "feat(work): /gc/review shows catalog ID + rights, same-work linking, exclusive-conflict warning"
```

---

### Task 4: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `work_identity_test.sql`).
- [ ] **Step 2: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 3: Leak-check** — invoke the `leak-check` skill (confirm clean).
- [ ] **Step 4: Manual (founder, GC account).** Two orgs submit the same film (`in_review`). On `/gc/review`: each card shows the catalog ID, org, and declared rights; a same-work **suggestion** appears → click **Link as same work**. With both holding exclusive SVOD-US → an **exclusive conflict** notice names the counterpart. Make one non-exclusive → the notice clears on refresh. Confirm the client's own title page shows **no** conflict notice.
- [ ] **Step 5: Commit any fixups** — `git add -A && git commit -m "chore(work): verification fixups"`.

---

## Self-Review

**1. Spec coverage:**
- `works` + `titles.work_id` (nullable, GC-write-only) → Task 1 ✓ (write path confirmed Step 3)
- `link_title_to_work_of` RPC (SECURITY DEFINER, is_gc_staff, create/join) → Task 1 ✓
- `territories_overlap` (single truth, reused by B-del) → Task 1 ✓ (truth table Task 2)
- `same_work_conflicts` computed, GC-only, exclusivity-aware → Task 1 (SECURITY INVOKER) ✓; RLS-fails-closed for clients tested → Task 2 ✓
- `suggest_same_work` (title+year, unlinked, cross-org) → Task 1 ✓ (Task 2) 
- `/gc/review`: catalog ID + rights/exclusivity + suggestions + link + conflict warning → Task 3 ✓
- Warning never on client surface → Task 3 (GC-only page) + Task 2 (client RLS returns none) ✓
- Seams (B-del reuse, findings store, client messaging, canonical-ID, work merge) → excluded ✓

**2. Placeholder scan:** No TBD/TODO. Full SQL (table, 4 functions, RLS, revokes), full pgTAP (16 assertions), full server action + client component + page. Suggestion ranking uses title+year (runtime/director tiebreakers noted as a future refinement in the spec, not required here).

**3. Type consistency:** `same_work_conflicts` returns `{other_org_name, other_title, other_title_id, rights_type}` — consumed in Task 3 as `c.rights_type`/`c.other_title`/`c.other_org_name`. `suggest_same_work` returns `{title_id, title, org_name, release_year}` = the `Suggestion` type in `link-controls.tsx` (Task 3 Step 2) consumed by the page (Step 3). `linkTitleToWork(titleId, targetTitleId)` signature matches the client call. `RIGHTS_META[rights_type].label` + `describeTerritory(mode, territories)` are existing helpers. Grant select columns match `rights_grants`.
