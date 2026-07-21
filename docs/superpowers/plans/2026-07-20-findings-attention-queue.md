# Findings + attention queue — Implementation Plan

**Goal:** A persisted validator-findings store + attention-queue surfaces: `findings` table + `reconcile_title_findings`/`my_findings` RPCs, a TS metadata-completeness validator, wired into the metadata-save + submit paths, surfaced on the client dashboard and a GC cross-org page.

**Branch:** `findings-attention-queue` off `main`. No new env/deps. Execute lean: migration founder-approved; validator + wiring + surfaces inline; whole-branch review + PR at end.

## Global Constraints
- pnpm. RLS is authz (read = `is_gc_staff OR member_can(view)`; writes RPC-only). Rule 4: every finding carries `source_refs`+`logic_version`+`derived_at`. Rule 5: `tg_audit` on findings. Precision over recall — validator-only, deterministic, auto-resolving. `sender='gc_support'`, `source='validator'` in v1. Canonical field list stays in `metadata.ts` (no SQL copy). Copy in `lib/`; tokens only. Destructive-ops approval gate on the migration.

## Task 1 — Migration + RPCs + pgTAP  *(heavy — destructive-ops STOP)*
**Files:** `supabase/migrations/20260720000600_findings.sql`, `supabase/tests/findings_test.sql`, regen `database.types.ts`.
- 4 enums (`finding_source|sender|severity|status`); `findings` table per the spec's data model (unique `(entity_type, entity_id, code, source)`; indexes `(org_id,status)`,`(entity_type,entity_id)`,`(status)`; `tg_audit` trigger).
- RLS: `enable rls`; `revoke all from anon`; `revoke insert,update,delete from authenticated`; SELECT policy `is_gc_staff(auth.uid()) or member_can(auth.uid(), org_id,'view')`.
- **`reconcile_title_findings(p_org_id uuid, p_title_id uuid, p_findings jsonb, p_logic_version text) returns void`** SECURITY DEFINER: auth `member_can(...,'operate') or is_gc_staff`; title belongs to org; `insert … on conflict (entity_type,entity_id,code,source) do update set status='open',severity,message,source_refs,logic_version,derived_at=now(),resolved_at=null` for each element of `p_findings` (jsonb array; `entity_type='title'`, `source='validator'`, `sender='gc_support'`); then resolve open validator rows for the title whose `code` is not in the incoming set. Iterate `jsonb_array_elements(p_findings)`; collect incoming codes into a `text[]` for the resolve step.
- **`my_findings() returns setof public.findings`** SECURITY DEFINER: `select * from findings where public.member_can(auth.uid(), org_id,'view') and status='open' order by severity desc, created_at`.
- `revoke execute … from public, anon; grant execute … to authenticated` on both.
- pgTAP `findings_test.sql`: reconcile inserts N open; re-run with a subset auto-resolves the dropped code (AI-source row untouched); `operate`-gate (viewer throws 'Not authorized', owner + gc lives_ok); RLS (client sees own-org open, not other org's; anon denied); `my_findings` returns caller's open only.
- STOP for founder approval → apply → `supabase test db` → regen types → commit.

## Task 2 — TS validator  *(inline)*
**Files:** `src/lib/metadata.ts` (+ `src/lib/metadata.test.ts` if absent — add cases).
- `export const METADATA_LOGIC_VERSION = "metadata-v1";`
- `export type FindingDescriptor = { code: string; severity: "high"|"low"; message: string; field: string; tier: "required"|"recommended" };`
- `export function computeMetadataFindings(data: Record<string, unknown>): FindingDescriptor[]` — for each `METADATA_FIELDS` entry with `tier==='required'` whose value is empty (`coalesce`/trim-empty per the same emptiness rule as `requiredComplete`): push `{code:'metadata.missing.'+f.key, severity:'high', tier:'required', field:f.key, message:`${f.label} is required.`}`. Same for `tier==='recommended'` → `severity:'low'`, `message:`${f.label} is recommended.``. Optional tier ignored.
- Vitest: empty `{}` → 6 high + 4 low (current registry); full valid → `[]`; partial → exact subset; codes/severities/messages correct. `pnpm test src/lib/metadata.test.ts`; commit.

## Task 3 — Wire reconcile into metadata-save + submit  *(inline)*
**Files:** `src/app/(app)/titles/[id]/metadata/actions.ts`, `src/app/(app)/titles/[id]/actions.ts` (submit action).
- After `set_title_metadata` succeeds: read the title's `org_id` (from the metadata action's context — it already has org/title) + the just-saved `data`; `const findings = computeMetadataFindings(data)`; `await supabase.rpc('reconcile_title_findings', { p_org_id, p_title_id, p_findings: findings, p_logic_version: METADATA_LOGIC_VERSION })`. Don't fail the save if reconcile errors — best-effort (log), the save already succeeded.
- After `submit_title` succeeds (submit action): re-read the title's metadata `data` + org, same reconcile call (submit is a §19 trigger; also catches a title submitted via a path that skipped a metadata save).
- `pnpm typecheck && pnpm build`; commit.

## Task 4 — Surfaces  *(inline)*
**Files:** `src/app/(app)/page.tsx` (replace placeholder), create `src/app/gc/findings/page.tsx`, `src/app/gc/layout.tsx` (+ nav entry), copy in `src/lib/findings.ts`.
- **Dashboard:** `const { data: findings } = await supabase.rpc('my_findings')`; group by `entity_id` (title), fetch title names (join or a `titles` select over the ids); render grouped, high first; each row → link to `/titles/<id>/metadata`. Empty → "Nothing needs your attention." Keep the existing org-summary card.
- **`/gc/findings`:** `supabase.from('findings').select('..., organizations(name), ...').eq('status','open')` (GC RLS = all orgs) + resolve title names; list with org + title + message + severity; simple severity filter. Add "Findings" to the GC nav in `src/app/gc/layout.tsx`.
- `src/lib/findings.ts`: severity labels + any copy.
- `pnpm typecheck && pnpm build`; commit.

## Task 5 — Verify + review + PR  *(inline)*
- Full suite: `supabase test db`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- `leak-check` (no secrets — findings are non-secret; sanity only).
- Whole-branch review (opus); fix Critical/Important; PR off `main`.

## Self-review
Covers §19 v1: one store (T1), validator + labels + provenance (T1,T2), event-driven reconcile on the two triggers (T3), client queue + GC cross-org (T4), precision (validator-only, auto-resolve). Deferred seams (notifications/health/AI/Globee) untouched but shaped. Types: `computeMetadataFindings` output shape (`code/severity/message/field/tier`) matches the reconcile `p_findings` element shape.
