# Metadata-intake (guided form / path 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SEQUENCING — read first:** this branch (`feat/metadata-intake`) was cut from `main` before PR #3 (asset-upload) merged. Before implementing, **rebase onto the merged `main`** so this inherits (a) the assets section already on `/titles/[id]/page.tsx`, (b) the systemic `fix(auth): scope membership queries to the caller`, and (c) the `zod` dependency (added in PR #3). Task 4's page edits assume the post-rebase page.tsx (rights + assets sections present, membership query already `.eq("user_id", user.id)`). If `zod` is somehow absent, `pnpm add zod`.

**Goal:** A schema-driven guided form that captures tiered title metadata, validated by a single canonical registry and stored as an immutable-per-write jsonb blob.

**Architecture:** One field registry in `lib/metadata.ts` is the single source of truth — it renders the form AND builds the zod validator. Metadata is a `jsonb` blob in a `title_metadata` table, written only through the `set_title_metadata` upsert RPC. Saving allows partial drafts (types + controlled-vocab validated); required-completeness is computed for a later delivery gate, not enforced here.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres (RLS, SECURITY DEFINER RPC, pgTAP), `zod`, TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-18-metadata-intake-design.md`. Domain source: `docs/domain-spec.md` §12/§19/§13.
- **Canonical spec is "not inventable"** — the field list here is an **explicitly provisional core** (Option B), swappable with zero schema change (it lives only in `lib/metadata.ts`).
- **RLS is the authorization boundary** — SELECT via `member_can(view)`; writes only through `set_title_metadata` (re-checks `member_can(operate)` + title∈org); no client table writes.
- **The validator decides** (§12) — deterministic zod against the canonical registry, controlled vocabularies for genre/language/country. AI never enters this slice.
- **Save = partial drafts allowed** — validate types + vocab of provided fields; do NOT require required-tier presence. "Required blocks delivery" is a later gate.
- **Mutable + audited** — metadata is editable draft data; `audit_log` via `tg_audit` records every write (golden rule 5). Unlike assets/grants, UPDATE is NOT revoked (the RPC is the sole writer; there is no client write policy).
- **Conventions:** UUID/`timestamptz`/`snake_case`, TS strict, zod at the edge; regenerate `database.types.ts` after the migration (strip leaked CLI lines — Task 1); design tokens + greyscale errors (D3).
- **Migration filename:** `supabase/migrations/20260718000700_title_metadata.sql` (verify it sorts after PR #3's `…000600`; bump if the merged main introduced a higher number).
- **Destructive-ops rule** — the migration creates triggers; show exact SQL, founder runs `supabase migration up` + `supabase gen types` (guard hook blocks the assistant).

---

### Task 1: Migration — `title_metadata` table, RLS, `set_title_metadata` RPC

**Files:**
- Create: `supabase/migrations/20260718000700_title_metadata.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `organizations`, `titles`, `member_can`, `tg_audit`, `tg_set_updated_at`.
- Produces: table `public.title_metadata`; `public.set_title_metadata(p_org_id uuid, p_title_id uuid, p_data jsonb) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260718000700_title_metadata.sql
--
-- INTENT: Metadata intake (domain-spec §12) — path 1 (guided form). One jsonb
-- blob per title, validated app-side by the canonical registry (lib/metadata.ts)
-- and written only via set_title_metadata. Mutable draft data (client edits the
-- form); audit_log is the change record (golden rule 5). "Required blocks
-- delivery" is enforced later at the delivery/in_review gate, not here.
--
-- DELIBERATELY EXCLUDED (seams): paths 2/3 (template, BYO-sheet + AI mapping),
-- findings/health queue, export mapping, delivery-blocking of required fields.
--
-- DESTRUCTIVE OPS (approved before apply): audit + updated_at triggers on
-- title_metadata. Forward-only + idempotent.
-- ============================================================================

create table if not exists public.title_metadata (
  title_id   uuid primary key references public.titles(id)        on delete restrict,
  org_id     uuid not null    references public.organizations(id) on delete restrict,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists title_metadata_org_idx on public.title_metadata (org_id);

drop trigger if exists audit_title_metadata on public.title_metadata;
create trigger audit_title_metadata after insert or update or delete on public.title_metadata
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_title_metadata on public.title_metadata;
create trigger set_updated_at_title_metadata before update on public.title_metadata
  for each row execute function public.tg_set_updated_at();

alter table public.title_metadata enable row level security;
revoke all on public.title_metadata from anon;

drop policy if exists title_metadata_select on public.title_metadata;
create policy title_metadata_select on public.title_metadata for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
-- INSERT/UPDATE: only via set_title_metadata() RPC. No client write policy, so
-- direct client writes are RLS-denied. NOT immutable — the RPC legitimately
-- updates — so UPDATE is not revoked at the permission level.

-- Write path: upsert. Capability re-checked; title must belong to the org. The
-- app validates p_data against the canonical zod schema BEFORE calling this.
create or replace function public.set_title_metadata(
  p_org_id   uuid,
  p_title_id uuid,
  p_data     jsonb
) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to edit metadata for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;

  insert into public.title_metadata (title_id, org_id, data)
    values (p_title_id, p_org_id, coalesce(p_data, '{}'::jsonb))
  on conflict (title_id) do update
    set data = excluded.data, updated_at = now();
end;
$$;

revoke execute on function public.set_title_metadata(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.set_title_metadata(uuid, uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Show the destructive SQL (two triggers) for approval; founder applies + regenerates**

```
! supabase migration up
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then strip any leaked CLI lines; verify `title_metadata` + `set_title_metadata` are present and the file starts with `export type Json =` / ends with `} as const`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718000700_title_metadata.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): title_metadata — jsonb store, RLS, set_title_metadata upsert RPC"
```

---

### Task 2: pgTAP — isolation, capability, cross-org, upsert

**Files:**
- Create: `supabase/tests/title_metadata_test.sql`

**Interfaces:**
- Consumes: `title_metadata`, `set_title_metadata` (Task 1).

- [ ] **Step 1: Write the test** (mirrors `assets_test.sql`)

```sql
-- title_metadata_test.sql
-- Metadata: tenant isolation, set_title_metadata capability matrix, cross-org
-- rejection, and upsert (second call updates, one row).

begin;
select plan(9);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.title_a',gen_random_uuid()::text, false);
select set_config('t.title_b',gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, 'Title A'),
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Title B');

-- Fixture metadata (owner-role setup).
insert into public.title_metadata (title_id, org_id, data)
values (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, '{"synopsis":"x"}'::jsonb);

-- ===== authenticated =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.title_metadata where org_id = current_setting('t.org_a')::uuid $$,
  'owner_a sees own org metadata');
select is((select count(*) from public.title_metadata where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B metadata (tenant isolation)');

select throws_ok($$ update public.title_metadata set data = '{}'::jsonb $$,
  '42501', null, 'direct client UPDATE is RLS-denied (RPC-only write path)');

select lives_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid, '{"synopsis":"updated","runtime_minutes":90}'::jsonb) $$,
  'account_owner: set_title_metadata succeeds');
-- upsert: still one row, data updated
select is((select count(*) from public.title_metadata where title_id = current_setting('t.title_a')::uuid)::int,
  1, 'upsert keeps a single row per title');
select is((select data->>'synopsis' from public.title_metadata where title_id = current_setting('t.title_a')::uuid),
  'updated', 'upsert updated the data');

-- cross-org: title B not in org A → raises
select throws_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_b')::uuid, '{}'::jsonb) $$,
  'P0001', null, 'set_title_metadata rejects a title from another org');

-- viewer cannot
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid, '{}'::jsonb) $$,
  'P0001', null, 'viewer: set_title_metadata raises (not operate-capable)');

-- GC staff (all orgs)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.set_title_metadata(
  current_setting('t.org_b')::uuid, current_setting('t.title_b')::uuid, '{"synopsis":"b"}'::jsonb) $$,
  'gc_staff: set_title_metadata succeeds on any org');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** (after Task 1 applied) — `supabase test db` → `title_metadata_test.sql ... ok`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/title_metadata_test.sql
git commit -m "test(db): title_metadata — isolation, capability, cross-org, upsert"
```

---

### Task 3: Canonical registry + zod builder + vocab (`lib/metadata.ts`, `lib/languages.ts`)

**Files:**
- Create: `src/lib/languages.ts`
- Create: `src/lib/metadata.ts`

**Interfaces:**
- Produces:
  - `lib/languages.ts`: `LANGUAGES: { value: string; label: string }[]` (ISO 639-1, provisional common set)
  - `lib/metadata.ts`: `FieldDef` type; `METADATA_FIELDS: FieldDef[]`; `GENRES`/`RATINGS` vocab; `metadataSchema` (zod, all-optional, strips unknown); `parseMetadata(input): { ok: true; data } | { ok: false; error }`; `requiredComplete(data): { filled: number; total: number }`

- [ ] **Step 1: Create `src/lib/languages.ts`**

```ts
// ISO 639-1 (value) → English name (label). Provisional common set — extend to
// the full standard when vendor requirements land (this is Option B's core).
export const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" }, { value: "es", label: "Spanish" },
  { value: "fr", label: "French" }, { value: "de", label: "German" },
  { value: "it", label: "Italian" }, { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" }, { value: "sv", label: "Swedish" },
  { value: "no", label: "Norwegian" }, { value: "da", label: "Danish" },
  { value: "fi", label: "Finnish" }, { value: "pl", label: "Polish" },
  { value: "ru", label: "Russian" }, { value: "uk", label: "Ukrainian" },
  { value: "cs", label: "Czech" }, { value: "el", label: "Greek" },
  { value: "tr", label: "Turkish" }, { value: "ar", label: "Arabic" },
  { value: "he", label: "Hebrew" }, { value: "hi", label: "Hindi" },
  { value: "bn", label: "Bengali" }, { value: "ta", label: "Tamil" },
  { value: "ur", label: "Urdu" }, { value: "fa", label: "Persian" },
  { value: "zh", label: "Chinese" }, { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" }, { value: "th", label: "Thai" },
  { value: "vi", label: "Vietnamese" }, { value: "id", label: "Indonesian" },
  { value: "ms", label: "Malay" }, { value: "tl", label: "Tagalog" },
  { value: "sw", label: "Swahili" }, { value: "af", label: "Afrikaans" },
  { value: "hu", label: "Hungarian" }, { value: "ro", label: "Romanian" },
  { value: "bg", label: "Bulgarian" }, { value: "hr", label: "Croatian" },
  { value: "sr", label: "Serbian" }, { value: "sk", label: "Slovak" },
];
```

- [ ] **Step 2: Create `src/lib/metadata.ts`**

```ts
import { z } from "zod";
import { ISO_COUNTRIES } from "@/lib/territories";
import { LANGUAGES } from "@/lib/languages";

export type Tier = "required" | "recommended" | "optional";
export type FieldType = "text" | "textarea" | "number" | "select" | "list";
export type FieldDef = {
  key: string;
  label: string;
  tier: Tier;
  type: FieldType;
  vocab?: { value: string; label: string }[]; // for `select`
};

// Provisional genre + rating vocabularies (Option B — swap when vendors confirm).
export const GENRES: { value: string; label: string }[] = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance",
  "Sci-Fi", "Sport", "Thriller", "War", "Western",
].map((g) => ({ value: g.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: g }));

export const RATINGS: { value: string; label: string }[] = [
  "G", "PG", "PG-13", "R", "NC-17", "NR",
].map((r) => ({ value: r, label: r }));

const COUNTRIES = Object.entries(ISO_COUNTRIES).map(([value, label]) => ({ value, label }));

// THE canonical field registry — single source for the form AND the validator.
export const METADATA_FIELDS: FieldDef[] = [
  { key: "synopsis", label: "Synopsis", tier: "required", type: "textarea" },
  { key: "runtime_minutes", label: "Runtime (minutes)", tier: "required", type: "number" },
  { key: "release_year", label: "Release year", tier: "required", type: "number" },
  { key: "genre", label: "Genre", tier: "required", type: "select", vocab: GENRES },
  { key: "primary_language", label: "Primary language", tier: "required", type: "select", vocab: LANGUAGES },
  { key: "country_of_origin", label: "Country of origin", tier: "required", type: "select", vocab: COUNTRIES },
  { key: "director", label: "Director", tier: "recommended", type: "text" },
  { key: "cast", label: "Cast", tier: "recommended", type: "list" },
  { key: "rating", label: "Rating", tier: "recommended", type: "select", vocab: RATINGS },
  { key: "keywords", label: "Keywords", tier: "recommended", type: "list" },
  { key: "alternate_title", label: "Alternate title", tier: "optional", type: "text" },
  { key: "production_company", label: "Production company", tier: "optional", type: "text" },
];

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.type) {
    case "number":
      return z.number().int().nonnegative();
    case "list":
      return z.array(z.string().min(1));
    case "select": {
      const values = (f.vocab ?? []).map((v) => v.value);
      return z.enum(values as [string, ...string[]]);
    }
    default: // text, textarea
      return z.string().min(1);
  }
}

// All fields optional → partial drafts are valid; provided fields are type/vocab
// checked. Unknown keys are stripped (zod object default). "The validator decides."
export const metadataSchema = z.object(
  Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, fieldSchema(f).optional()])),
);

export type MetadataData = z.infer<typeof metadataSchema>;

export function parseMetadata(
  input: unknown,
): { ok: true; data: MetadataData } | { ok: false; error: string } {
  const r = metadataSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: `${first.path.join(".") || "field"}: ${first.message}` };
}

// Required-tier completeness — drives the detail-page summary and (later) the
// delivery gate. A field counts as filled if present and non-empty.
export function requiredComplete(data: Record<string, unknown>): { filled: number; total: number } {
  const req = METADATA_FIELDS.filter((f) => f.tier === "required");
  const filled = req.filter((f) => {
    const v = data?.[f.key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== "";
  }).length;
  return { filled, total: req.length };
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/languages.ts src/lib/metadata.ts
git commit -m "feat(metadata): canonical field registry + zod builder + vocab (provisional core)"
```

---

### Task 4: Guided-form sub-route + detail-page summary

**Files:**
- Create: `src/app/(app)/titles/[id]/metadata/page.tsx`
- Create: `src/app/(app)/titles/[id]/metadata/metadata-form.tsx`
- Create: `src/app/(app)/titles/[id]/metadata/actions.ts`
- Modify: `src/app/(app)/titles/[id]/page.tsx` (add a metadata completeness summary + link)

**Interfaces:**
- Consumes: `METADATA_FIELDS`, `parseMetadata`, `requiredComplete`, `MetadataData` (Task 3); `set_title_metadata` RPC (Task 1); `resolveOperable`-style membership check (inline, `.eq("user_id", user.id)`); primitives `Input`, `Button`, `InlineNotice`, `Card`, `PageHeader`.
- Produces: server action `saveMetadata(orgId, titleId, values): Promise<{ error?: string }>`.

- [ ] **Step 1: Create `metadata/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { parseMetadata } from "@/lib/metadata";

// Save (upsert) title metadata. Validates against the canonical zod schema
// (the validator decides) then writes via the set_title_metadata RPC.
export async function saveMetadata(
  orgId: string,
  titleId: string,
  values: unknown,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const parsed = parseMetadata(values);
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.rpc("set_title_metadata", {
    p_org_id: orgId,
    p_title_id: titleId,
    p_data: parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${titleId}`);
  revalidatePath(`/titles/${titleId}/metadata`);
  return {};
}
```

- [ ] **Step 2: Create `metadata/metadata-form.tsx`** (schema-driven; renders `METADATA_FIELDS`)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { METADATA_FIELDS, type FieldDef } from "@/lib/metadata";
import { saveMetadata } from "./actions";

const TIER_ORDER: FieldDef["tier"][] = ["required", "recommended", "optional"];
const TIER_LABEL: Record<FieldDef["tier"], string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

// Build the form value map from stored data (arrays → comma strings for `list`).
function toFormState(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of METADATA_FIELDS) {
    const v = data?.[f.key];
    out[f.key] = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  }
  return out;
}

// Convert form strings back to typed values; omit empties (partial draft).
function toValues(state: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of METADATA_FIELDS) {
    const raw = (state[f.key] ?? "").trim();
    if (raw === "") continue;
    if (f.type === "number") out[f.key] = Number(raw);
    else if (f.type === "list") out[f.key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else out[f.key] = raw;
  }
  return out;
}

export function MetadataForm({
  orgId,
  titleId,
  initial,
}: {
  orgId: string;
  titleId: string;
  initial: Record<string, unknown>;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, string>>(() => toFormState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function set(key: string, value: string) {
    setState((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await saveMetadata(orgId, titleId, toValues(state));
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-xl">
      {TIER_ORDER.map((tier) => (
        <fieldset key={tier} className="flex flex-col gap-3">
          <legend className="t-body-sm font-medium text-ink-2">{TIER_LABEL[tier]}</legend>
          {METADATA_FIELDS.filter((f) => f.tier === tier).map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="t-body-sm text-ink-2">{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={4}
                  className="w-full rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body text-ink outline-none focus:border-accent"
                />
              ) : f.type === "select" ? (
                <select
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body text-ink"
                >
                  <option value="">—</option>
                  {(f.vocab ?? []).map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  value={state[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.type === "list" ? "Comma-separated" : undefined}
                />
              )}
            </label>
          ))}
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Saving…" : "Save metadata"}
        </Button>
        {saved ? <span className="t-body-sm text-ink-3">Saved.</span> : null}
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

- [ ] **Step 3: Create `metadata/page.tsx`** (server component; caller-scoped authz)

```tsx
import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { MetadataForm } from "./metadata-form";
import { METADATA_FIELDS } from "@/lib/metadata";

export default async function TitleMetadataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: title } = await supabase
    .from("titles")
    .select("id, title, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound();

  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", title.org_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const canOperate = m?.role === "account_owner" || m?.role === "delivery_ops";

  const { data: row } = await supabase
    .from("title_metadata")
    .select("data")
    .eq("title_id", id)
    .maybeSingle();
  const data = (row?.data as Record<string, unknown> | null) ?? {};

  return (
    <>
      <PageHeader
        title={title.title}
        subtitle="Metadata"
        backLink={{ href: `/titles/${id}`, label: "Back to title" }}
      />
      {canOperate ? (
        <MetadataForm orgId={title.org_id} titleId={title.id} initial={data} />
      ) : (
        <dl className="flex flex-col gap-2 max-w-xl">
          {METADATA_FIELDS.map((f) => {
            const v = data[f.key];
            const shown = Array.isArray(v) ? v.join(", ") : v == null ? "—" : String(v);
            return (
              <div key={f.key} className="flex justify-between gap-4 border-b border-hairline py-1.5">
                <dt className="t-body-sm text-ink-3">{f.label}</dt>
                <dd className="t-body-sm text-ink-2">{shown}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add a metadata summary + link to `titles/[id]/page.tsx`**

Add the import near the other `@/lib` imports:

```tsx
import { requiredComplete } from "@/lib/metadata";
```

Fetch the metadata row alongside the existing `grants`/`assets` fetches:

```tsx
  const { data: metaRow } = await supabase
    .from("title_metadata")
    .select("data")
    .eq("title_id", id)
    .maybeSingle();
  const complete = requiredComplete((metaRow?.data as Record<string, unknown>) ?? {});
```

Add this section after the Assets section (before the closing `</>`) — post-rebase the Assets section is present:

```tsx
      <div className="mt-10">
        <div className="flex items-center justify-between gap-4 pb-3">
          <h2 className="t-body font-medium text-ink">Metadata</h2>
          <Link href={`/titles/${id}/metadata`} className="t-body-sm text-accent">
            {canOperate ? "Edit metadata" : "View metadata"}
          </Link>
        </div>
        <p className="t-body-sm text-ink-3">
          {complete.filled} of {complete.total} required fields complete
        </p>
      </div>
```

(`Link` from `next/link` is already imported on the titles pages; if not present in this file, add `import Link from "next/link";`.)

- [ ] **Step 5: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green; `/titles/[id]/metadata` appears as a route.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/titles/[id]/metadata" "src/app/(app)/titles/[id]/page.tsx"
git commit -m "feat(metadata): guided-form sub-route + completeness summary on title detail"
```

---

### Task 5: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `title_metadata_test.sql`).
- [ ] **Step 2: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 3: Leak-check** — invoke the `leak-check` skill (no new secrets this slice; confirm clean).
- [ ] **Step 4: Manual (founder):** on `/titles/[id]` click "Edit metadata" → fill some (not all) required fields + a bad value (`runtime_minutes = abc`) → confirm the type error blocks save; fix it → save → return to detail → summary shows "N of 6 required complete"; reload persists. A `viewer` sees the read-only metadata view and no edit form.
- [ ] **Step 5: Commit fixups** — `git add -A && git commit -m "chore(metadata): verification fixups"` (if needed).

---

## Self-Review

**1. Spec coverage:**
- `title_metadata` jsonb table + RLS + triggers → Task 1 ✓
- `set_title_metadata` upsert RPC (operate-gated, title∈org) → Task 1 ✓
- Canonical registry + zod builder (single source) → Task 3 ✓
- Controlled vocab (genre provisional, language ISO 639-1, country via territories) → Task 3 ✓
- Save allows partial drafts; types/vocab validated → Task 3 (`metadataSchema` all-optional) + Task 4 (`saveMetadata`) ✓
- `requiredComplete` summary (not enforcement) → Task 3 + Task 4 ✓
- Guided-form sub-route + detail summary/link → Task 4 ✓
- pgTAP (isolation, capability, cross-org, upsert) → Task 2 ✓
- Seams (paths 2/3, findings, export, delivery-blocking) → excluded, noted ✓
- Provisional-core swappability (lib-only, no schema change) → registry in `lib/metadata.ts` ✓

**2. Placeholder scan:** No TBD/TODO. The provisional field/vocab lists are intentional (Option B) and explicitly labeled. All code complete.

**3. Type consistency:** `saveMetadata(orgId, titleId, values)` matches between Task 4 action and form. `set_title_metadata(p_org_id, p_title_id, p_data)` matches Task 1 SQL and the `.rpc` call. `METADATA_FIELDS`/`FieldDef`/`parseMetadata`/`requiredComplete`/`metadataSchema` names match between Task 3 definitions and Task 4 use. `requiredComplete().total` = 6 (the six required fields), consistent with the manual-check "N of 6".
