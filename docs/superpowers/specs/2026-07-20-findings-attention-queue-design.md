# Findings + attention queue (validator only) — design

> Status: design pending approval. Builds domain-spec **§19** (findings, health, attention queue) and
> **§20** (two channels) — v1 scope: **validator findings + attention queue** (notifications, health
> score, AI findings, Ask Globee all deferred, §19/§21). First table to carry the rule-4 provenance
> triple (`source_refs` + `logic_version` + `derived_at`). Independent of the portal stack; branches off
> `main`. This doc is the *how*.

## Context

§19: **one findings store** — the attention queue (push) and, later, Globee (pull) read the *same*
table; **Globee reads it as a tool and never recomputes**. Findings are **event-driven** (fire when a
title is submitted or its metadata changes, not on read), **advisory records** with a source +
timestamp. Two types, **never blended**: **validator** (zod against the canonical spec — always right,
labeled *requirement*) and **AI** (judgment — suggestion, deferred). **Precision over recall: false
flags kill the queue.** Everything carries a **`sender`** (`gc_support | globee`).

The canonical field registry already exists — `src/lib/metadata.ts` `METADATA_FIELDS` (the same required
tier `submit_title` gates on). Field *validity* (vocab/type) is enforced at write (`metadataSchema` in
`set_title_metadata`), so the validator's real job is **completeness**. The v1 validator turns
metadata-completeness gaps into requirement findings.

## Scope

**In:**
- **`findings` table** — persisted, provenance-carrying, one store. Enums `finding_source`
  (`validator|ai`), `finding_sender` (`gc_support|globee`), `finding_severity` (`high|low`),
  `finding_status` (`open|resolved`). RLS read = `is_gc_staff OR member_can(view)`; writes RPC-only.
- **Validator (TS, canonical)** — `computeMetadataFindings(data)` in `src/lib/metadata.ts`: from
  `METADATA_FIELDS`, emit a finding per **missing required** (severity `high`) and **missing
  recommended** (severity `low`) field. Carries a `METADATA_LOGIC_VERSION` constant.
- **`reconcile_title_findings` RPC** (SECURITY DEFINER, `operate`-or-GC): for a title's **validator**
  findings only, upsert the current set as `open` and mark absent ones `resolved` (auto-resolve —
  deterministic requirements clear themselves; no manual clear for validator findings). AI findings
  untouched. Fired from the **metadata-save** and **submit** server actions (§19's two triggers).
- **Reads:** `my_findings()` (SECURITY DEFINER, org-scoped via `member_can`) for the client queue; GC
  reads the table directly under RLS (all-org via `is_gc_staff`).
- **Surfaces:** client **attention queue** on the dashboard (`(app)/page.tsx`, replacing the
  placeholder) — open findings grouped by title, high first; **GC cross-org view** at new `/gc/findings`.
- pgTAP + Vitest + manual.

**Out (seams — designed, not built):**
- **Notifications (email + in-app)** — the next slice; fires off finding *creation*. The store +
  `sender` are ready.
- **Health score** — an aggregate whose `source_refs` **are** these findings (§19); `catalog-health`
  stub stays untouched. Deferred (needs volume + the finalized canonical spec).
- **AI findings** — `source='ai'` rows in this same table; never blended with validator (§19).
- **Ask Globee** — its `get_findings` tool reads this store; never recomputes.

## Key decisions

- **Validator findings only, deterministic, auto-resolving** — precision over recall; nothing fuzzy in
  v1. A finding resolves when its condition clears (recompute + reconcile), like the derived "Live"
  rollup — not a manual clear.
- **Persisted + reconciled, not computed-on-read** — one store both the queue and (later) Globee read;
  notifications need to detect *new* findings; provenance needs `derived_at`. So the validator writes to
  the store and reconciles on the triggering events.
- **Canonical spec stays in `metadata.ts`** — the validator reads `METADATA_FIELDS` (no third copy of
  the field list in SQL; `submit_title`'s hardcoded required array is the existing known smell, not
  extended here).
- **`sender='gc_support'`** for all v1 findings (the institution's push channel). **`logic_version`
  mandatory from day one** — the field registry is an open founder decision (§21.1) and *will* move.
- **One finding per missing field** (`code = 'metadata.missing.<field>'`) — more actionable than one
  bundled per title.
- **Client queue on the dashboard; GC cross-org at `/gc/findings`** (founder-confirmed) — `catalog-health`
  left for the deferred health score.

## Data model

```sql
create type public.finding_source   as enum ('validator','ai');
create type public.finding_sender   as enum ('gc_support','globee');
create type public.finding_severity as enum ('high','low');
create type public.finding_status   as enum ('open','resolved');

create table public.findings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,
  entity_type  text not null,                 -- 'title' in v1
  entity_id    uuid not null,
  code         text not null,                 -- e.g. 'metadata.missing.synopsis'
  source       public.finding_source   not null,
  sender       public.finding_sender   not null default 'gc_support',
  severity     public.finding_severity not null,
  status       public.finding_status   not null default 'open',
  message      text not null,
  -- rule-4 provenance triple (first table to carry it):
  source_refs  jsonb not null,                -- {title_id, field, tier}
  logic_version text not null,                -- METADATA_LOGIC_VERSION at compute time
  derived_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (entity_type, entity_id, code, source)  -- one open/resolved row per (entity, code, source)
);
-- indexes: (org_id, status), (entity_type, entity_id), (status)
-- audit trigger tg_audit (has org_id) for provenance of finding open/resolve transitions.
```
- **RLS:** `revoke all from anon`; `revoke insert, update, delete from authenticated` (RPC-only);
  SELECT policy `using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'))`.
- **Uniqueness** on `(entity_type, entity_id, code, source)` lets reconcile upsert: a re-opened finding
  flips `status` back to `open` + updates `derived_at` rather than duplicating.

## Enforcement — reconcile

**`reconcile_title_findings(p_org_id uuid, p_title_id uuid, p_findings jsonb, p_logic_version text)
returns void`** — SECURITY DEFINER, `member_can(auth.uid(), p_org_id, 'operate') or is_gc_staff`.
`p_findings` = `[{code, severity, message, field, tier}, …]` (the TS validator's output).
1. Auth gate; confirm the title belongs to `p_org_id`.
2. Upsert each incoming finding: `insert … on conflict (entity_type, entity_id, code, source) do update`
   set `status='open', severity, message, source_refs, logic_version, derived_at=now(), resolved_at=null`
   (source fixed `'validator'`, sender `'gc_support'`, entity_type `'title'`).
3. `update findings set status='resolved', resolved_at=now()` where this title's `source='validator'`
   rows are **open** and their `code` is **not** in the incoming set.
Only touches `source='validator'` — AI findings are never reconciled here.

**Client read `my_findings() returns setof findings`** — SECURITY DEFINER, `member_can(view)`-scoped to
the caller's orgs (GC bypass sees all). Ordered severity desc, created_at.

## Validator (TS)

`src/lib/metadata.ts`:
- `export const METADATA_LOGIC_VERSION = "metadata-v1";`
- `export function computeMetadataFindings(data): FindingDescriptor[]` — for each `METADATA_FIELDS`
  entry in the `required` tier that is empty → `{code:'metadata.missing.'+field, severity:'high',
  tier:'required', field, message:'<Label> is required.'}`; each `recommended` tier empty →
  `severity:'low', tier:'recommended', message:'<Label> is recommended.'`. Pure, Vitest-tested.

The metadata-save + submit server actions, after the write, read the title's metadata + org, call
`computeMetadataFindings`, then `supabase.rpc('reconcile_title_findings', …)`.

## Surfaces

- **`(app)/page.tsx`** (client dashboard, replace placeholder): `my_findings()` → group by title, high
  first; each row: title link, field message, severity. Empty state: "Nothing needs your attention."
- **`/gc/findings`** (new GC page, is_gc_staff-gated by the `gc` layout): open findings across orgs
  (join org + title names), filter by org/severity. Reads the table under RLS (GC all-org).
- Copy in `lib/`; tokens only.

## Verification

- **pgTAP:** reconcile upserts open + auto-resolves absent (validator-only, AI untouched); RLS (client
  sees own org, not others; GC sees all; anon denied; direct writes revoked); `operate`-gate on
  reconcile (viewer denied, owner/delivery_ops allowed, GC allowed); `my_findings` org-scoping.
- **Vitest:** `computeMetadataFindings` — empty metadata → 6 high + 4 low; full → none; partial → the
  right subset; codes/severities correct.
- **Manual:** a draft title missing fields shows in the dashboard queue; filling a required field
  resolves that finding on next save; GC `/gc/findings` shows it cross-org; a `viewer` can see but not
  trigger writes.

## Seams left clean

Notifications read new `open` findings (next slice). Health score aggregates these (its `source_refs`
*are* findings). AI findings = `source='ai'` in this table. Globee's `get_findings` reads it. The
`(entity_type, entity_id)` shape generalizes beyond titles (assets/deliveries) without schema change.

## Dependency & branching

Off `main` (independent of the portal PRs). No new env/deps.
