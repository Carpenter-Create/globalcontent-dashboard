# Vendor records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GC-administered, global `vendors` table + a `/gc/vendors` CRUD surface — the foundation delivery tracking (slice B) builds on.

**Architecture:** `vendors` is the first non-tenant table (no `org_id`); RLS gates every operation on `is_gc_staff`. Writes are RLS-gated direct table writes inside a server action (a deliberate, documented deviation from mutations-as-RPC — GC-admin data with no tenant-isolation surface). The UI lives on the existing `(gc)` route group behind its `is_gc_staff` layout gate.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres (RLS, pgTAP), `zod`, TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-vendor-records-design.md`. Domain source: `docs/domain-spec.md` §13.
- **GC-global, `is_gc_staff`-gated** — `vendors` has no `org_id`; RLS SELECT/INSERT/UPDATE = `is_gc_staff(auth.uid())`. No DELETE (golden rule 2 — `active` toggles).
- **Writes = RLS-gated direct writes in a server action** (not a SECURITY DEFINER RPC, not client-side) — documented deviation logged in `known-divergences`.
- **Portal creds are NEVER stored** (§13) — no column for them.
- **`export_format_spec` / `email_*` stored now, consumed later** (export slice C, email slice D).
- **Conventions:** UUID/`timestamptz`/`snake_case`; TS strict; zod at the edge; regenerate `database.types.ts` after the migration (strip leaked CLI lines); design tokens + greyscale errors (D3).
- **Migration filename:** `supabase/migrations/20260719000200_vendors.sql` (sorts after `…000100`).
- **Destructive-ops:** migration creates a trigger; founder runs `supabase migration up` + `supabase gen types`.
- **Branch:** `feat/vendor-records` off `main` (`c3ff740`, all merged) — no rebase needed.

---

### Task 1: Migration — `vendor_mode` enum, `vendors` table, RLS

**Files:**
- Create: `supabase/migrations/20260719000200_vendors.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `is_gc_staff`, `tg_audit`, `tg_set_updated_at` (prior migrations).
- Produces: enum `public.vendor_mode` (`portal_upload|email`); table `public.vendors`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260719000200_vendors.sql
--
-- INTENT: GC-administered vendor records (domain-spec §13) — the first NON-tenant
-- table (no org_id): vendors are GC's shared distribution partners, the same list
-- for every client. RLS gates all ops on is_gc_staff. Writes are RLS-gated direct
-- writes (a server action), NOT a SECURITY DEFINER RPC — GC-admin data with no
-- tenant-isolation surface (documented deviation; see known-divergences). No
-- DELETE: `active` toggles (golden rule 2). Portal creds are NEVER stored (§13).
--
-- DELIBERATELY EXCLUDED (seams): deliveries (slice B), client vendor visibility,
-- export mapping consuming export_format_spec (C), email send (D), Glacier (E).
--
-- DESTRUCTIVE OPS (approved before apply): audit + updated_at triggers on vendors.
-- Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.vendor_mode as enum ('portal_upload','email');
exception when duplicate_object then null; end $$;

create table if not exists public.vendors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  company_info       jsonb,
  delivery_mode      public.vendor_mode not null,
  export_format_spec jsonb,                          -- stored now; consumed by the export slice
  email_to           text[] not null default '{}',
  email_cc           text[] not null default '{}',
  email_template     text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vendors_email_recipients_chk check (
    delivery_mode <> 'email' or array_length(email_to, 1) >= 1
  )
);
create unique index if not exists vendors_name_unique on public.vendors (lower(name));
create index if not exists vendors_active_idx on public.vendors (active);

-- Provenance: reuse the generic audit trigger. vendors has no org_id, so tg_audit
-- logs the row with org_id = null (a GC-only/system audit row — audit_log's select
-- policy already shows null-org rows to gc_staff only).
drop trigger if exists audit_vendors on public.vendors;
create trigger audit_vendors after insert or update or delete on public.vendors
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_vendors on public.vendors;
create trigger set_updated_at_vendors before update on public.vendors
  for each row execute function public.tg_set_updated_at();

alter table public.vendors enable row level security;
revoke all on public.vendors from anon;

-- GC-only, all operations (no org predicate — vendors are global). is_gc_staff is
-- SECURITY DEFINER (reads gc_staff without recursion), so these are non-recursive.
drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists vendors_insert on public.vendors;
create policy vendors_insert on public.vendors for insert to authenticated
  with check (public.is_gc_staff(auth.uid()));
drop policy if exists vendors_update on public.vendors;
create policy vendors_update on public.vendors for update to authenticated
  using (public.is_gc_staff(auth.uid())) with check (public.is_gc_staff(auth.uid()));
-- No DELETE policy — nothing is deleted (active = false instead).
```

- [ ] **Step 2: Show destructive SQL (two triggers) for approval; founder applies + regenerates**

```
! supabase migration up
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then strip any leaked CLI lines; verify `vendors` + `vendor_mode` present and the file starts with `export type Json =` / ends with `} as const`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719000200_vendors.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): vendors — GC-global table, vendor_mode enum, is_gc_staff RLS"
```

---

### Task 2: pgTAP — is_gc_staff read+write, client denial, CHECK, uniqueness

**Files:**
- Create: `supabase/tests/vendors_test.sql`

**Interfaces:**
- Consumes: `vendors`, `is_gc_staff` (Task 1).

- [ ] **Step 1: Write the test**

```sql
-- vendors_test.sql
-- vendors: GC-only read+write, client denial, email-mode CHECK, name uniqueness.

begin;
select plan(9);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values (current_setting('t.org_a')::uuid, 'Org A');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

set local role authenticated;

-- ===== GC staff: full CRUD (except delete) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ insert into public.vendors (name, delivery_mode) values ('Vendor One', 'portal_upload') $$,
  'gc_staff: insert vendor (portal_upload) succeeds');
select lives_ok($$ insert into public.vendors (name, delivery_mode, email_to) values ('Vendor Two', 'email', array['ops@vendor.test']) $$,
  'gc_staff: insert vendor (email + recipient) succeeds');
select isnt_empty($$ select 1 from public.vendors where name = 'Vendor One' $$,
  'gc_staff: reads vendors');
select lives_ok($$ update public.vendors set active = false where name = 'Vendor One' $$,
  'gc_staff: update (deactivate) succeeds');

-- email mode requires a recipient (CHECK)
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('No Email', 'email') $$,
  '23514', null, 'email mode without email_to violates CHECK');

-- case-insensitive name uniqueness
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('vendor one', 'portal_upload') $$,
  '23505', null, 'duplicate name (case-insensitive) rejected');

-- ===== client account_owner: no read, no write =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.vendors)::int, 0, 'client: cannot read vendors (RLS)');
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('Sneaky', 'portal_upload') $$,
  '42501', null, 'client: insert denied (RLS)');
-- A client UPDATE matches no rows under RLS (USING is false) → affects 0 rows
-- rather than raising, so assert the row count, not a throw.
select is(
  (with u as (update public.vendors set active = false where name = 'Vendor Two' returning 1)
   select count(*) from u)::int,
  0, 'client: update affects 0 rows (RLS)');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** (after Task 1 applied) — `supabase test db` → `vendors_test.sql ... ok`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/vendors_test.sql
git commit -m "test(db): vendors — GC-only read+write, client denial, CHECK, uniqueness"
```

---

### Task 3: `/gc/vendors` — list, create/edit form, server action, GC nav

**Files:**
- Create: `src/app/gc/vendors/actions.ts`
- Create: `src/app/gc/vendors/vendor-form.tsx`
- Create: `src/app/gc/vendors/page.tsx` (list + create)
- Create: `src/app/gc/vendors/[id]/page.tsx` (edit)
- Modify: `src/app/gc/layout.tsx` (add Review · Vendors nav)
- Modify: `docs/known-divergences.md` (log the RLS-gated-writes deviation)

**Interfaces:**
- Consumes: `vendors` table + RLS (Task 1); `createClient`; primitives `Button`, `Input`, `InlineNotice`, `Card`/`CardBody`.
- Produces: server action `saveVendor(input): Promise<{ error?: string }>` where
  `input = { id?: string; name: string; deliveryMode: "portal_upload"|"email"; emailTo: string; emailCc: string; emailTemplate: string; companyInfoJson: string; exportSpecJson: string; active: boolean }`.

- [ ] **Step 1: Create `actions.ts`** (RLS-gated direct write in a server action)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  deliveryMode: z.enum(["portal_upload", "email"]),
  emailTo: z.string(),
  emailCc: z.string(),
  emailTemplate: z.string(),
  companyInfoJson: z.string(),
  exportSpecJson: z.string(),
  active: z.boolean(),
});

function toList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function parseJsonOrNull(s: string): { ok: true; value: unknown } | { ok: false } {
  const t = s.trim();
  if (t === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

// GC-admin vendor create/update. RLS (is_gc_staff) is the boundary; this is a
// direct table write (not an RPC) inside a server action — see known-divergences.
export async function saveVendor(raw: unknown): Promise<{ error?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const emailTo = toList(v.emailTo);
  if (v.deliveryMode === "email" && emailTo.length === 0) {
    return { error: "Email delivery requires at least one recipient." };
  }
  const company = parseJsonOrNull(v.companyInfoJson);
  const spec = parseJsonOrNull(v.exportSpecJson);
  if (!company.ok) return { error: "Company info is not valid JSON." };
  if (!spec.ok) return { error: "Export format spec is not valid JSON." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const row = {
    name: v.name.trim(),
    delivery_mode: v.deliveryMode,
    email_to: emailTo,
    email_cc: toList(v.emailCc),
    email_template: v.emailTemplate.trim() || null,
    company_info: company.value as never,
    export_format_spec: spec.value as never,
    active: v.active,
  };

  const { error } = v.id
    ? await supabase.from("vendors").update(row).eq("id", v.id)
    : await supabase.from("vendors").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/gc/vendors");
  return {};
}
```

- [ ] **Step 2: Create `vendor-form.tsx`** (shared create/edit client form)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { saveVendor } from "./actions";

export type VendorInitial = {
  id?: string;
  name: string;
  deliveryMode: "portal_upload" | "email";
  emailTo: string;
  emailCc: string;
  emailTemplate: string;
  companyInfoJson: string;
  exportSpecJson: string;
  active: boolean;
};

const EMPTY: VendorInitial = {
  name: "",
  deliveryMode: "portal_upload",
  emailTo: "",
  emailCc: "",
  emailTemplate: "",
  companyInfoJson: "",
  exportSpecJson: "",
  active: true,
};

export function VendorForm({ initial }: { initial?: VendorInitial }) {
  const router = useRouter();
  const [v, setV] = useState<VendorInitial>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof VendorInitial>(k: K, val: VendorInitial[K]) {
    setV((s) => ({ ...s, [k]: val }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setError("Name is required.");
    setSaving(true);
    setError("");
    const res = await saveVendor(v);
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    router.push("/gc/vendors");
    router.refresh();
  }

  const ta = "w-full rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body-sm text-ink outline-none focus:border-accent";

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Name</span>
        <Input value={v.name} onChange={(e) => set("name", e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Delivery mode</span>
        <select
          value={v.deliveryMode}
          onChange={(e) => set("deliveryMode", e.target.value as VendorInitial["deliveryMode"])}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body-sm text-ink"
        >
          <option value="portal_upload">Portal upload</option>
          <option value="email">Email</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email recipients (comma-separated)</span>
        <Input value={v.emailTo} onChange={(e) => set("emailTo", e.target.value)} placeholder="ops@vendor.example" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email CC (comma-separated)</span>
        <Input value={v.emailCc} onChange={(e) => set("emailCc", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email template</span>
        <textarea value={v.emailTemplate} onChange={(e) => set("emailTemplate", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Company info (JSON, optional)</span>
        <textarea value={v.companyInfoJson} onChange={(e) => set("companyInfoJson", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Export format spec (JSON, optional)</span>
        <textarea value={v.exportSpecJson} onChange={(e) => set("exportSpecJson", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        <span className="t-body-sm text-ink-2">Active</span>
      </label>

      <Button type="submit" disabled={saving} className="self-start">
        {saving ? "Saving…" : "Save vendor"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

- [ ] **Step 3: Create `page.tsx`** (list + create)

```tsx
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { VendorForm } from "./vendor-form";

const MODE_LABELS: Record<"portal_upload" | "email", string> = {
  portal_upload: "Portal upload",
  email: "Email",
};

export default async function GcVendorsPage() {
  const supabase = await createClient();
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, delivery_mode, active")
    .order("name", { ascending: true });
  const list = vendors ?? [];

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Vendors</h1>
      <p className="t-body-sm text-ink-3 pb-6">GC distribution partners. Portal credentials are never stored here.</p>

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No vendors yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="mb-8 flex flex-col gap-2">
          {list.map((vn) => (
            <Link key={vn.id} href={`/gc/vendors/${vn.id}`} className="block">
              <Card className="transition-colors hover:bg-surface-muted">
                <CardBody className="flex items-center justify-between gap-4">
                  <span className="t-body font-medium text-ink">{vn.name}</span>
                  <span className="t-body-sm text-ink-3">
                    {MODE_LABELS[vn.delivery_mode]}
                    {vn.active ? "" : " · inactive"}
                  </span>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <h2 className="t-body font-medium text-ink pb-3">New vendor</h2>
      <VendorForm />
    </>
  );
}
```

- [ ] **Step 4: Create `[id]/page.tsx`** (edit)

```tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { VendorForm } from "../vendor-form";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: vn } = await supabase
    .from("vendors")
    .select("id, name, delivery_mode, email_to, email_cc, email_template, company_info, export_format_spec, active")
    .eq("id", id)
    .maybeSingle();
  if (!vn) notFound(); // RLS: a non-GC user is already redirected by the (gc) layout

  return (
    <>
      <PageHeader title={vn.name} subtitle="Edit vendor" backLink={{ href: "/gc/vendors", label: "Vendors" }} />
      <VendorForm
        initial={{
          id: vn.id,
          name: vn.name,
          deliveryMode: vn.delivery_mode,
          emailTo: (vn.email_to ?? []).join(", "),
          emailCc: (vn.email_cc ?? []).join(", "),
          emailTemplate: vn.email_template ?? "",
          companyInfoJson: vn.company_info ? JSON.stringify(vn.company_info, null, 2) : "",
          exportSpecJson: vn.export_format_spec ? JSON.stringify(vn.export_format_spec, null, 2) : "",
          active: vn.active,
        }}
      />
    </>
  );
}
```

- [ ] **Step 5: Add the GC nav to `gc/layout.tsx`**

Replace the header block's single title with a title + nav. Change the `<div className="mb-8 flex items-baseline justify-between">…</div>` to:

```tsx
      <div className="mb-8 flex items-baseline justify-between">
        <div className="flex items-baseline gap-6">
          <span className="t-subhead text-ink">Global Content</span>
          <nav className="flex gap-4">
            <Link href="/gc/review" className="t-body-sm text-ink-2 hover:text-ink">Review</Link>
            <Link href="/gc/vendors" className="t-body-sm text-ink-2 hover:text-ink">Vendors</Link>
          </nav>
        </div>
        <span className="t-body-sm text-ink-3">GC {staff.role.replace("gc_", "").replace("_", " ")}</span>
      </div>
```
Add `import Link from "next/link";` at the top of `gc/layout.tsx`.

- [ ] **Step 6: Log the deviation in `docs/known-divergences.md`**

Add under a new `## Vendors / GC-admin` section:

```markdown
## Vendors / GC-admin

### V1 — vendor writes are RLS-gated direct writes, not mutation-RPCs
`vendors` is GC-global (no `org_id`) and gated entirely on `is_gc_staff`. Its create/edit path is a
**direct table write inside a server action** (`supabase.from("vendors").insert/update`, RLS-enforced),
not a SECURITY DEFINER RPC. Deliberate: GC-admin reference data with no tenant-isolation surface — an
RPC would only re-wrap `is_gc_staff` + insert with no security gain (the one cross-field rule is a
CHECK constraint). The mutations-as-RPC rule stays in force for all client/tenant writes.
**Trigger to revisit:** if a vendor write ever needs a cross-table invariant or server-derived state.
```

- [ ] **Step 7: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green; `/gc/vendors` and `/gc/vendors/[id]` appear as routes.

- [ ] **Step 8: Commit**

```bash
git add src/app/gc docs/known-divergences.md
git commit -m "feat(vendors): /gc/vendors CRUD (RLS-gated direct writes) + GC nav"
```

---

### Task 4: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `vendors_test.sql`).
- [ ] **Step 2: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 3: Leak-check** — invoke the `leak-check` skill (no new secrets; confirm clean).
- [ ] **Step 4: Manual (founder, as a `gc_staff` account).** On `/gc/vendors`: create a `portal_upload` vendor and an `email` vendor (confirm email mode requires a recipient); the list shows both; click one → edit → toggle Active → save → the list marks it inactive; a duplicate name is rejected. Confirm a non-GC user visiting `/gc/vendors` is redirected by the `(gc)` gate. (Reuse the `gc_delivery_ops` grant from the in_review demo, or provision one.)
- [ ] **Step 5: Commit any fixups** — `git add -A && git commit -m "chore(vendors): verification fixups"`.

---

## Self-Review

**1. Spec coverage:**
- `vendor_mode` enum + GC-global `vendors` table + CHECK + unique(lower(name)) + triggers → Task 1 ✓
- RLS `is_gc_staff` SELECT/INSERT/UPDATE, no DELETE → Task 1 ✓
- RLS-gated direct writes via server action (no RPC) → Task 3 (`saveVendor`) ✓; deviation logged → Task 3 Step 6 ✓
- Portal creds never stored → no column (Task 1) ✓
- `export_format_spec`/`email_*` stored, unused → columns present, form populates (Tasks 1/3) ✓
- `/gc/vendors` list + create/edit + GC nav → Task 3 ✓
- pgTAP (GC read+write, client denial, CHECK, uniqueness) → Task 2 ✓
- Seams (deliveries, client visibility, export, email, Glacier) → excluded, noted ✓

**2. Placeholder scan:** No TBD/TODO. The Task-2 note replaces the client-UPDATE assertion with the `is(...)`-count form (RLS makes it affect 0 rows, not throw) — a real correction, not a placeholder. Raw-JSON textareas for `company_info`/`export_format_spec` are the founder-approved v1. All code complete.

**3. Type consistency:** `saveVendor(input)` shape matches `VendorInitial` (Task 3) and the `Input` zod schema. `delivery_mode` values (`portal_upload|email`) consistent across enum, zod, form, and labels. `vendors` column names in the edit-page select match the DB (Task 1). The `(gc)` layout edit adds `Link` import alongside the new nav.
