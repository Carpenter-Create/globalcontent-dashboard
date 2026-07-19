# Vendor records — design (slice A of vendors + delivery)

> Status: design pending approval. On the org/RLS/provenance spine + the `(gc)` surface from the
> in_review slice. Source of truth for *what*: `docs/domain-spec.md` §13 (delivery/vendors). This
> doc is the *how* for **vendor records only** — the GC-admin foundation deliveries (slice B) build on.

## Context

Build order: `… → in_review gate ✓ → vendor records → delivery status`. §13 delivery is manual and
GC-driven. Before deliveries can exist (`title × vendor × territory`), GC needs a **vendors** list.
This slice is that list — a GC-administered, **global** (not per-client) reference table + a CRUD
surface — decomposed out of the larger §13 area. Delivery tracking (B), export mapping (C), email
send (D), Glacier `restoring` (E), and client notifications (F) are separate later slices, most
blocked on unbuilt infra.

Second GC-side workflow — builds directly on the `(gc)` route group + `is_gc_staff` gate shipped
with in_review.

## Scope

**In:**
- `vendor_mode` enum (`portal_upload | email`) + `vendors` table (GC-global) + indexes + CHECK + audit/updated_at triggers
- **RLS: `is_gc_staff` for SELECT and INSERT/UPDATE** (GC-only; no org scope). No DELETE (golden rule 2).
- `/gc/vendors` — list + create/edit form, under the existing `(gc)` group
- A minimal GC nav (Review · Vendors) added to `(gc)/layout.tsx`
- pgTAP

**Out (seams):**
- Deliveries (`title × vendor × territory`) — slice B
- Client-facing vendor visibility — arrives in B via delivery rows
- Export mapping consuming `export_format_spec` — slice C ("one mapping engine")
- Email templating/sending, GC-user signature — slice D (needs CloudFront signing + email provider)
- Glacier `restoring` — slice E
- Vendor portal credentials — **never stored** (password manager, §13)

## Key decisions

- **GC-global, not org-scoped** — vendors are GC's shared distribution partners, identical for every
  client. First non-tenant table; no `org_id`. RLS gates on `is_gc_staff` alone (mirrors `gc_staff`).
- **Writes are RLS-gated direct writes, NOT mutation-RPCs** — a deliberate, documented deviation
  (logged in `known-divergences`). Justification: vendors is GC-internal admin data with zero
  tenant-isolation surface; the only capability is `is_gc_staff`, which RLS enforces directly. An
  RPC would re-wrap `is_gc_staff` + insert with no security gain (no cross-tenant check; the one
  cross-field rule is a CHECK). The mutations-as-RPC rule stays in force for client/tenant writes.
- **No delete** — `active` boolean toggles a vendor off; the row never leaves (golden rule 2).
- **Portal creds never in the DB** (§13) — no column for them; they live in a password manager.
- **`export_format_spec` stored now, consumed later** — a `jsonb` column populated by GC but not read
  until the export slice (C); it will power both export and vendor-specific health checks.

## Data model

```sql
create type vendor_mode as enum ('portal_upload','email');

create table vendors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  company_info       jsonb,
  delivery_mode      vendor_mode not null,
  export_format_spec jsonb,                          -- stored now; consumed by the export slice
  email_to           text[] not null default '{}',   -- always-recipients for email mode
  email_cc           text[] not null default '{}',
  email_template     text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vendors_email_recipients_chk check (
    delivery_mode <> 'email' or array_length(email_to, 1) >= 1
  )
);
create unique index vendors_name_unique on vendors (lower(name));  -- no duplicate vendors
create index vendors_active_idx on vendors (active);
```
- Audit + updated_at triggers (reuse the generic functions). Not immutable — vendor records are
  editable admin data; `audit_log` records every change (golden rule 5).
- The `vendors_email_recipients_chk` enforces the one cross-field rule declaratively, regardless of
  write path.

## RLS

```sql
alter table vendors enable row level security;
revoke all on vendors from anon;
create policy vendors_select on vendors for select to authenticated using (is_gc_staff(auth.uid()));
create policy vendors_insert on vendors for insert to authenticated with check (is_gc_staff(auth.uid()));
create policy vendors_update on vendors for update to authenticated
  using (is_gc_staff(auth.uid())) with check (is_gc_staff(auth.uid()));
-- no DELETE policy (nothing is deleted)
```
GC-only, all operations. No org predicate — vendors are global. `is_gc_staff` is SECURITY DEFINER
(reads `gc_staff` without recursion), so these policies are non-recursive.

## Surface — `/gc/vendors`

Under the existing `(gc)` group (already `is_gc_staff`-gated by `(gc)/layout.tsx`):
- **`/gc/vendors`** — list active + inactive vendors (name, mode, active); "New vendor" + per-row "Edit".
- **Create/edit form** (client component) → a **server action** that does the RLS-gated direct
  write (`supabase.from("vendors").insert/update`) via the request-scoped **server** client — a
  direct table write (RLS enforces `is_gc_staff`), *not* an RPC and *not* a client-side DB write
  (keeps DB access off the client, consistent with the repo). zod-validated in the action. Fields:
  name, delivery_mode, email_to/cc (comma lists), email_template, company_info/export_format_spec
  (raw JSON textareas for v1), active. Greyscale errors (D3).
- **GC nav:** add a small nav row to `(gc)/layout.tsx` linking `/gc/review` and `/gc/vendors`.

> Note: RLS (`is_gc_staff`) is the boundary for both read and write; the server action carries the
> caller's session so the policy applies. "Direct write" = a table insert/update, not a SECURITY
> DEFINER RPC — the deliberate deviation for GC-admin reference data.

## Verification

- **pgTAP `vendors_test.sql`:** a `gc_staff` user can SELECT/INSERT/UPDATE; a client `account_owner`
  can do **none** (RLS denies read + write); the email-mode CHECK rejects an `email` vendor with no
  `email_to`; `active` toggle works; duplicate name (case-insensitive) rejected.
- `typecheck` / `lint` / `build` green; `leak-check`; manual on `/gc/vendors` (create a vendor of each
  mode, edit, toggle active; confirm a non-GC user is redirected by the `(gc)` gate).

## Seams left clean

`vendors.id` is the FK target for slice B's `deliveries` (`title × vendor × territory`).
`export_format_spec`/`email_*` are populated now and consumed by the export (C) and email (D) slices.
`delivery_mode` tells B/D which delivery path a vendor uses.
