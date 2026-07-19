# Rights exclusivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-grant **exclusivity** in the rights carve-out — a required choice at intake — so the later cross-client conflict rule has something to enforce against.

**Architecture:** Add `exclusive boolean` to `rights_grants`; make `add_rights_grant` take a **required** `p_exclusive` (dropping/replacing the function, since the arg list changes); thread it through the `addRights` server action and the intake form (no default — the client must choose); display it on the title-detail rights list. This slice **captures and stores only** — nothing reads `exclusive` yet.

**Tech Stack:** Supabase Postgres (RLS, SECURITY DEFINER RPC, pgTAP), Next.js App Router (server actions + client form), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-rights-exclusivity-design.md`. Domain source: `docs/domain-spec.md` §9.
- **Branch:** `feat/rights-exclusivity` off `main` (`c3ff740`). The vendors migration (`20260719000200`) lives on the separate `feat/vendor-records` branch / PR #7 and is **not** on this branch — expected. This slice touches only `rights_grants`, which is on `main`.
- **Migration filename:** `supabase/migrations/20260719000300_rights_exclusivity.sql` — sorts after `…000100` (highest on this branch) and coexists cleanly with `…000200` (vendors) once PR #7 merges.
- **Capture only — no enforcement.** Nothing reads `exclusive` in this slice. The conflict rule (soft warning at review, hard block at delivery) is slices B-work / B-del.
- **Exclusivity is per-grant** (`rights_type` + territory set). **One exclusivity per add-action**, applied to every rights type in that add; mixed exclusivity in one territory = two adds.
- **Required, un-defaulted choice.** `p_exclusive` has **no `DEFAULT`** → the generated TS makes it a required arg (repo known gotcha), and the intake form has **no pre-selection** — submit stays disabled until the client chooses. Plain-language explainer at the control. Greyscale errors (D3).
- **DB column default (`false`) applies only to pre-existing/backfilled rows** — never a new declaration (the RPC param is required).
- **Conventions:** UUID/`timestamptz`/`snake_case`; TS strict; regenerate `database.types.ts` after the migration (strip any leaked CLI lines); design tokens; no hardcoded hex.
- **Destructive-ops (approved before apply):** `alter table … add column` + `drop function` + `create or replace function`. Founder runs the apply + `gen types`.

---

### Task 1: Migration — `exclusive` column + required `p_exclusive` on `add_rights_grant`

**Files:**
- Create: `supabase/migrations/20260719000300_rights_exclusivity.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `rights_grants`, `add_rights_grant` (existing), `member_can` (existing).
- Produces: `rights_grants.exclusive boolean not null`; new `add_rights_grant(uuid, uuid, rights_type[], territory_mode, text[], **boolean**, timestamptz, timestamptz, timestamptz)` returning `uuid[]`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260719000300_rights_exclusivity.sql
--
-- INTENT: capture per-grant EXCLUSIVITY in the rights carve-out (domain-spec §9;
-- design 2026-07-19-rights-exclusivity). A grant IS (rights_type, territory set),
-- so exclusivity rides on the row as one boolean. Required at intake — the
-- add_rights_grant RPC gains a REQUIRED p_exclusive (no default). CAPTURE ONLY:
-- nothing reads `exclusive` yet; the cross-client conflict rule (soft warning at
-- review, hard block at delivery) is a later slice.
--
-- DESTRUCTIVE OPS (approved before apply): alter table add column; drop + replace
-- add_rights_grant (arg list changes → new overload; drop the old to avoid
-- ambiguity). Forward-only + idempotent where possible.
-- ============================================================================

alter table public.rights_grants
  add column if not exists exclusive boolean not null default false;
comment on column public.rights_grants.exclusive is
  'Exclusivity of this grant''s (rights_type, territory set). Read by the cross-client conflict rule (soft warning at review, hard block at delivery); unused at capture time. New declarations always set it explicitly; the default only applies to pre-existing rows.';

-- Drop the old 8-arg signature so the new 9-arg one is unambiguous.
drop function if exists public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  timestamptz, timestamptz, timestamptz);

-- p_exclusive is REQUIRED, so it must precede the defaulted params.
create or replace function public.add_rights_grant(
  p_org_id        uuid,
  p_title_id      uuid,
  p_rights_types  public.rights_type[],
  p_mode          public.territory_mode,
  p_territories   text[],
  p_exclusive     boolean,
  p_window_start  timestamptz default null,
  p_window_end    timestamptz default null,
  p_effective_from timestamptz default null
) returns uuid[]
  language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[] := '{}';
  v_type public.rights_type;
  v_id uuid;
  v_terr text[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to set rights for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if p_rights_types is null or array_length(p_rights_types, 1) is null then
    raise exception 'At least one rights type is required';
  end if;
  -- Defense in depth: the generated TS makes p_exclusive required, but a direct
  -- SQL caller could still pass null. Exclusivity is never implicit.
  if p_exclusive is null then
    raise exception 'Exclusivity must be specified';
  end if;

  -- Territories: normalize + dedupe + format-validate at the DB layer.
  if p_mode = 'world' then
    v_terr := '{}';
  else
    select array_agg(distinct upper(btrim(t)))
      into v_terr
      from unnest(coalesce(p_territories, '{}')) t
      where btrim(t) <> '';
    if v_terr is null or array_length(v_terr, 1) is null then
      raise exception 'Territory list required for include/exclude mode';
    end if;
    if exists (select 1 from unnest(v_terr) t where t !~ '^[A-Z]{2}$') then
      raise exception 'Territories must be ISO 3166-1 alpha-2 codes';
    end if;
  end if;

  -- Dedupe rights types (one immutable row per distinct type); all share p_exclusive.
  for v_type in select distinct unnest(p_rights_types) loop
    insert into public.rights_grants
      (org_id, title_id, rights_type, territory_mode, territories,
       exclusive, window_start, window_end, effective_from, created_by)
    values
      (p_org_id, p_title_id, v_type, p_mode, v_terr,
       p_exclusive, p_window_start, p_window_end, coalesce(p_effective_from, now()), auth.uid())
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

revoke execute on function public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  boolean, timestamptz, timestamptz, timestamptz) from public, anon;
grant  execute on function public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  boolean, timestamptz, timestamptz, timestamptz) to authenticated;
```

- [ ] **Step 2: Show destructive SQL (add column + drop/replace function) for approval; founder applies + regenerates**

Because this branch is off `main` (no vendors migration), the cleanest apply is a reset so history matches the branch's files:

```
! supabase db reset
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then strip any leaked CLI lines; verify the file starts with `export type Json =`, ends with `} as const`, and that `add_rights_grant`'s `Args` now include `p_exclusive: boolean` (required, not optional) and `rights_grants` Row has `exclusive: boolean`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719000300_rights_exclusivity.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): rights_grants.exclusive + required p_exclusive on add_rights_grant"
```

---

### Task 2: pgTAP — update signature callers + assert exclusivity persists

**Files:**
- Modify: `supabase/tests/rights_grants_test.sql`

**Interfaces:**
- Consumes: new `add_rights_grant` 9-arg signature (Task 1); `rights_grants.exclusive`.

> The `add_rights_grant` arg list changed, so **every positional call in this file must gain the `p_exclusive` arg at position 6** or the whole file errors. Direct `insert into public.rights_grants (...)` fixtures are unaffected — `exclusive` defaults to `false`.

- [ ] **Step 1: Update the plan count**

Change `select plan(16);` (line 7) to:
```sql
select plan(19);
```

- [ ] **Step 2: Add `false` (position 6) to the four existing `add_rights_grant` calls**

Update each call's arg list — insert `false` between the territories arg and the first `null`/window arg:

1. account_owner success (currently `array['fast']::public.rights_type[], 'world', '{}', null, null, now()`):
```sql
select lives_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', false, null, null, now()) $$,
  'account_owner: add_rights_grant succeeds');
```
2. dedupe:
```sql
select is(array_length(public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['bvod','bvod']::public.rights_type[], 'world', '{}', false, null, null, now()), 1),
  1, 'add_rights_grant dedupes duplicate rights types');
```
3. territory format validation:
```sql
select throws_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['tvod']::public.rights_type[], 'include', array['USA'], false, null, null, now()) $$,
  'P0001', null, 'add_rights_grant rejects non-alpha-2 territory code');
```
4. viewer denial:
```sql
select throws_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', false, null, null, now()) $$,
  'P0001', null, 'viewer: add_rights_grant raises (not operate-capable)');
```

- [ ] **Step 3: Add three exclusivity assertions** (in the `account_owner` block, after the dedupe test at line ~115, before switching to the viewer jwt)

```sql
-- exclusivity persists (true)
select is(
  (select exclusive from public.rights_grants
   where id = (public.add_rights_grant(
     current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
     array['pay_tv']::public.rights_type[], 'world', '{}', true, null, null, now()))[1]),
  true, 'add_rights_grant persists exclusive = true');

-- exclusivity persists (false)
select is(
  (select exclusive from public.rights_grants
   where id = (public.add_rights_grant(
     current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
     array['ppv']::public.rights_type[], 'world', '{}', false, null, null, now()))[1]),
  false, 'add_rights_grant persists exclusive = false');

-- one exclusivity applies to every rights_type created in the call
select is(
  (select count(distinct exclusive)::int from public.rights_grants
   where id = any(public.add_rights_grant(
     current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
     array['fvod','mod']::public.rights_type[], 'world', '{}', true, null, null, now()))),
  1, 'all rights_types in one add share the exclusivity flag');
```

- [ ] **Step 4: Run** — `supabase test db` → `rights_grants_test.sql ... ok` (19/19) and `All tests successful.`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/rights_grants_test.sql
git commit -m "test(db): rights exclusivity — persists true/false, shared across types; fix signature callers"
```

---

### Task 3: Intake + display — capture and show exclusivity

**Files:**
- Modify: `src/app/(app)/titles/[id]/actions.ts` (`addRights`)
- Modify: `src/app/(app)/titles/[id]/add-rights-form.tsx`
- Modify: `src/app/(app)/titles/[id]/page.tsx` (rights list display — this page is the pre-submit view)

**Interfaces:**
- Consumes: new `add_rights_grant` (Task 1); `rights_grants.exclusive`.
- Produces: `addRights` input gains `exclusive: boolean`.

- [ ] **Step 1: Thread `exclusive` through `addRights`** (`actions.ts`)

Add `exclusive: boolean;` to the input type and pass it to the RPC. Replace the input type + rpc call:

```ts
export async function addRights(input: {
  orgId: string;
  titleId: string;
  rightsTypes: RightsType[];
  mode: TerritoryMode;
  countryCodes: string[];
  exclusive: boolean;
  windowStart: string | null;
  windowEnd: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (input.rightsTypes.length === 0) return { error: "Select at least one rights type." };

  let territories: string[];
  try {
    territories = resolveTerritories(input.mode, input.countryCodes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid territories." };
  }

  const { error } = await supabase.rpc("add_rights_grant", {
    p_org_id: input.orgId,
    p_title_id: input.titleId,
    p_rights_types: input.rightsTypes,
    p_mode: input.mode,
    p_territories: territories,
    p_exclusive: input.exclusive,
    p_window_start: input.windowStart ?? undefined,
    p_window_end: input.windowEnd ?? undefined,
    p_effective_from: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}
```

- [ ] **Step 2: Add the exclusivity control to the form** (`add-rights-form.tsx`)

Add `exclusive` state (`null` = unchosen), a two-option control with a plain-language explainer, block submit until chosen, pass it through, and reset after. Full updated component:

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_CATEGORIES, type RightsType } from "@/lib/rights";
import type { TerritoryMode } from "@/lib/territories";
import { addRights } from "./actions";

// Minimal, functional grants form (not designer-grade): multi-select rights
// types grouped by category, a territory mode, a comma-separated ISO code field
// for include/exclude, and a REQUIRED exclusivity choice (no default — the
// client must actively choose; §9 conflict-prevention foundation). Greyscale
// errors (D3). Operate-capable only.
export function AddRightsForm({ orgId, titleId }: { orgId: string; titleId: string }) {
  const [types, setTypes] = useState<Set<RightsType>>(new Set());
  const [mode, setMode] = useState<TerritoryMode>("world");
  const [codes, setCodes] = useState("");
  const [exclusive, setExclusive] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(code: RightsType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (types.size === 0) {
      setError("Select at least one rights type.");
      return;
    }
    if (exclusive === null) {
      setError("Choose exclusive or non-exclusive.");
      return;
    }
    setSaving(true);
    setError("");
    const countryCodes =
      mode === "world" ? [] : codes.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await addRights({
      orgId,
      titleId,
      rightsTypes: [...types],
      mode,
      countryCodes,
      exclusive,
      windowStart: null,
      windowEnd: null,
    });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setTypes(new Set());
    setCodes("");
    setMode("world");
    setExclusive(null);
    setSaving(false);
  }

  const seg =
    "rounded-[var(--radius-sm)] border px-3 py-1.5 t-body-sm transition-colors";
  const segOn = "border-ink bg-ink text-surface";
  const segOff = "border-hairline bg-surface text-ink-2 hover:text-ink";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {RIGHTS_CATEGORIES.map((cat) => (
          <fieldset key={cat.category} className="flex flex-col gap-1.5">
            <legend className="t-body-sm font-medium text-ink-2">{cat.category}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {cat.types.map((t) => (
                <label key={t.code} className="flex items-center gap-1.5 t-body-sm text-ink-2">
                  <input type="checkbox" checked={types.has(t.code)} onChange={() => toggle(t.code)} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="territory-mode" className="t-body-sm text-ink-2">
          Territory
        </label>
        <select
          id="territory-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as TerritoryMode)}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
        >
          <option value="world">Worldwide</option>
          <option value="include">Only these countries</option>
          <option value="exclude">Worldwide except</option>
        </select>
      </div>
      {mode !== "world" ? (
        <Input
          aria-label="ISO country codes"
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          placeholder="Country codes, comma-separated (e.g. US, CA, GB)"
        />
      ) : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="t-body-sm font-medium text-ink-2">Exclusivity</legend>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={exclusive === true}
            onClick={() => setExclusive(true)}
            className={`${seg} ${exclusive === true ? segOn : segOff}`}
          >
            Exclusive
          </button>
          <button
            type="button"
            aria-pressed={exclusive === false}
            onClick={() => setExclusive(false)}
            className={`${seg} ${exclusive === false ? segOn : segOff}`}
          >
            Non-exclusive
          </button>
        </div>
        <p className="t-body-sm text-ink-3">
          Exclusive: only you may distribute this right in these territories. Non-exclusive: others may too.
        </p>
      </fieldset>

      <Button type="submit" disabled={saving || types.size === 0 || exclusive === null} className="self-start">
        {saving ? "Adding…" : "Add rights"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

- [ ] **Step 3: Display exclusivity in the rights list** (`page.tsx`)

Add `exclusive` to the grants select (line ~78) and show it in each grant card. Update the select:

```tsx
  const { data: grants } = await supabase
    .from("rights_grants")
    .select("id, rights_type, territory_mode, territories, exclusive, window_start, window_end")
    .eq("title_id", id)
    .is("effective_to", null)
    .order("created_at", { ascending: false });
```

Update the grant card body (the `list.map` block, ~lines 143-152) to show exclusivity:

```tsx
          {list.map((g) => (
            <Card key={g.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                  <span className="t-body-sm text-ink-3">{g.exclusive ? "Exclusive" : "Non-exclusive"}</span>
                </div>
                <span className="shrink-0 t-body-sm text-ink-2">
                  {describeTerritory(g.territory_mode, g.territories)}
                </span>
              </CardBody>
            </Card>
          ))}
```

- [ ] **Step 4: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green. The regenerated `add_rights_grant` Args require `p_exclusive`, so `actions.ts` must pass it (it does).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/titles
git commit -m "feat(rights): capture exclusivity at intake (required choice) + show on title detail"
```

---

### Task 4: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `rights_grants_test.sql` 19/19).
- [ ] **Step 2: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 3: Leak-check** — invoke the `leak-check` skill (no new secrets; confirm clean).
- [ ] **Step 4: Manual (founder, as an operate-capable client account).** On a draft title: the "Add rights" button stays disabled until an exclusivity option is chosen; add an **exclusive** SVOD · include US grant and a **non-exclusive** AVOD · worldwide grant; both appear in the rights list correctly labeled (Exclusive / Non-exclusive); the explainer text is visible. (Reuse a client org, or provision one.)
- [ ] **Step 5: Commit any fixups** — `git add -A && git commit -m "chore(rights): verification fixups"`.

---

## Self-Review

**1. Spec coverage:**
- `rights_grants.exclusive boolean not null` → Task 1 ✓
- `add_rights_grant` required `p_exclusive` (drop/replace, param before defaults) → Task 1 ✓
- Intake form: required, un-defaulted choice + explainer, submit blocked until chosen → Task 3 Step 2 ✓
- Thread through `addRights` action → Task 3 Step 1 ✓
- Display on title-detail rights list (the pre-submit view) → Task 3 Step 3 ✓
- pgTAP: persists true/false, shared across types; signature callers fixed → Task 2 ✓
- Capture only, no enforcement → no task reads `exclusive` ✓
- Existing rows default false; new declarations explicit → Task 1 (column default) + required param ✓
- Seams (work identity, conflict detection, deliveries, market-metadata, GC-review verification surface) → excluded, noted in spec ✓

**2. Placeholder scan:** No TBD/TODO. All code blocks complete (migration, test edits with exact arg positions, full form component, exact select + card edits). The "correctability" and "GC-review verification surface" items are explicitly deferred in the spec, not placeholders here.

**3. Type consistency:** `addRights` input `exclusive: boolean` (Task 3.1) matches the form's `exclusive` (non-null at call site — guarded by `exclusive === null` check, Task 3.2) and the RPC `p_exclusive: boolean` (Task 1). The `rights_grants` select adds `exclusive` (Task 3.3) matching the column (Task 1). pgTAP calls use the 9-arg positional signature consistently (Task 2). `RIGHTS_META[g.rights_type].label` and `describeTerritory(...)` are unchanged existing helpers.
