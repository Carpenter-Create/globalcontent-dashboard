# Asset-Access Portal — Slice 3 (Glacier Restoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the placeholder 409 "preparing" branch into a real Glacier flow: detect an archived master via S3 HEAD, auto-initiate a Standard restore on access (idempotent), show an honest "preparing (~3–5h)" state, and serve once S3 reports the temp copy available. Applies to master downloads + master-source screeners.

**Architecture:** A server-only `s3.ts` gains `headObjectRestore` / `initiateRestore` / `resolveOrRestore` (+ a pure `parseRestore`). The `/api/portal/download` and `/api/portal/screener` routes call `resolveOrRestore` after their resolve RPC, before signing: `restoring` → 409 (+ a best-effort `restore_requested` provenance event on first trigger); `available` → sign + serve. One DB change: `ALTER TYPE portal_event ADD VALUE 'restore_requested'`.

**Tech Stack:** Next.js 16, TS strict, `@aws-sdk/client-s3` (already present), Supabase, Vitest + pgTAP. pnpm.

**Branch:** `portal-3-glacier-restoring`, stacked on `portal-2-screener-room` (#14) → `portal-1-master-download` (#13). Do not merge before them.

## Global Constraints (verbatim)

- pnpm. **Rule 14** — HEAD/restore/sign are server-only; storage_key never reaches the client. **Rule 5** — `restore_requested` on the append-only `portal_access_events` (UPDATE/DELETE stay revoked incl. service_role). **Rule 3** — assets immutable (no restore column on assets). **Rule 10** — all logic server-side.
- **Standard retrieval tier**, `Days=7`. `initiateRestore` idempotent (`RestoreAlreadyInProgress` = success).
- **Auto-on-access** trigger; **retry-driven** ready-detection; **no proactive notify** (v1). GC pre-warm / notify-when-ready / Expedited are deferred seams.
- **Only masters Glacier** (lifecycle = founder infra, not code) — the helper returns `available` immediately for non-archived objects, so no kind branching.
- Secrets server-only; **new IAM permission `s3:RestoreObject`** (founder provisions). Copy in `lib/`; voice calm/declarative; banned words apply. Optional RPC args `default null` (n/a here).
- **Destructive-ops approval gate** on the migration (ADD VALUE) — hard stop in Task 1.

## File Structure
- Create: `supabase/migrations/20260720000500_restore_event.sql`, `supabase/tests/restore_test.sql`, `src/lib/s3.test.ts` (Vitest for `parseRestore`).
- Modify: `src/lib/s3.ts` (restore fns), `src/app/api/portal/download/route.ts`, `src/app/api/portal/screener/route.ts` (wire `resolveOrRestore`), `src/lib/portal.ts` (`PORTAL_COPY.errorPreparing` copy), `src/lib/supabase/database.types.ts` (regen), `docs/infra/asset-portal-setup.md` (IAM + lifecycle).

---

## Task 1 — Enum migration + pgTAP  *(WEIGHT: heavy — destructive-ops STOP)*

- [ ] **Step 1 — pgTAP** `supabase/tests/restore_test.sql` (mirror `portal_test.sql` fixture idioms):
```sql
begin;
select plan(2);
-- the enum value exists and an event inserts (as owner; service-role path in the app)
select set_config('t.link', gen_random_uuid()::text, false);
-- minimal: assert the label is present on the enum type
select is(
  (select count(*)::int from pg_enum e join pg_type t on t.oid=e.enumtypid
    where t.typname='portal_event' and e.enumlabel='restore_requested'),
  1, 'portal_event has restore_requested');
-- append-only still holds for the new label: service_role cannot UPDATE
reset role; set local role service_role;
select throws_ok(
  $$ update public.portal_access_events set event_type='restore_requested' $$,
  '42501', null, 'service_role cannot UPDATE portal_access_events (append-only)');
reset role;
select * from finish();
rollback;
```
- [ ] **Step 2 — run, expect FAIL:** `supabase test db` (enum label missing).
- [ ] **Step 3 — migration** `20260720000500_restore_event.sql`:
```sql
-- 20260720000500_restore_event.sql
-- INTENT: add 'restore_requested' to portal_event (Portal-3 Glacier restore provenance).
-- Isolated migration (own file) so the new enum value commits before app use.
-- DESTRUCTIVE OPS (approved before apply): alter type add value. Forward-only + idempotent.
alter type public.portal_event add value if not exists 'restore_requested';
```
- [ ] **Step 4 — STOP for destructive-ops approval.** Show the founder; do not apply.
- [ ] **Step 5 — apply + test:** founder runs the CLI reset; then `supabase test db` (all green).
- [ ] **Step 6 — regen types + typecheck:** `supabase gen types typescript --local > src/lib/supabase/database.types.ts`; `pnpm typecheck`.
- [ ] **Step 7 — commit.**

---

## Task 2 — `s3.ts` restore functions + Vitest  *(WEIGHT: medium — subagent + review)*

**Files:** modify `src/lib/s3.ts`; create `src/lib/s3.test.ts`.

**Interfaces produced:** `parseRestore(restoreHeader, storageClass): RestoreState`; `headObjectRestore(key): Promise<RestoreState>`; `initiateRestore(key, days?): Promise<void>`; `resolveOrRestore(key): Promise<{status:"available"} | {status:"restoring"; justInitiated:boolean}>`; type `RestoreState = "none"|"restoring"|"available"`.

- [ ] **Step 1 — Vitest first** `src/lib/s3.test.ts` (pure `parseRestore` — no AWS):
```ts
import { describe, expect, it } from "vitest";
import { parseRestore } from "./s3";

describe("parseRestore", () => {
  it("non-archived storage class is immediately available", () => {
    expect(parseRestore(undefined, undefined)).toBe("available"); // S3 omits class for STANDARD
    expect(parseRestore(undefined, "STANDARD")).toBe("available");
  });
  it("archived with no restore header → none", () => {
    expect(parseRestore(undefined, "GLACIER")).toBe("none");
    expect(parseRestore(undefined, "DEEP_ARCHIVE")).toBe("none");
  });
  it("restore in progress → restoring", () => {
    expect(parseRestore('ongoing-request="true"', "GLACIER")).toBe("restoring");
  });
  it("restore complete → available", () => {
    expect(parseRestore('ongoing-request="false", expiry-date="Wed, 30 Jul 2026 00:00:00 GMT"', "GLACIER")).toBe("available");
  });
});
```
- [ ] **Step 2 — run, expect FAIL** (`parseRestore` missing): `pnpm test src/lib/s3.test.ts`.
- [ ] **Step 3 — implement** in `src/lib/s3.ts`. Add to the existing import, then append the functions:
```ts
// add HeadObjectCommand, RestoreObjectCommand to the existing "@aws-sdk/client-s3" import
export type RestoreState = "none" | "restoring" | "available";

// Pure: map S3's StorageClass + x-amz-restore header to a servable state.
// STANDARD (S3 omits the header for it) → available. GLACIER/DEEP_ARCHIVE → none until a
// restore is requested; ongoing-request="true" → restoring; ="false" (with expiry-date) → available.
export function parseRestore(restoreHeader: string | undefined, storageClass: string | undefined): RestoreState {
  const archived = storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";
  if (!archived) return "available";
  if (!restoreHeader) return "none";
  if (/ongoing-request="true"/.test(restoreHeader)) return "restoring";
  if (/ongoing-request="false"/.test(restoreHeader)) return "available";
  return "none";
}

export async function headObjectRestore(key: string): Promise<RestoreState> {
  const out = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return parseRestore(out.Restore, out.StorageClass);
}

export async function initiateRestore(key: string, days = 7): Promise<void> {
  try {
    await s3.send(new RestoreObjectCommand({
      Bucket: S3_BUCKET, Key: key,
      RestoreRequest: { Days: days, GlacierJobParameters: { Tier: "Standard" } },
    }));
  } catch (e) {
    // Already restoring or already restored — not an error for our purposes.
    const name = (e as { name?: string; Code?: string })?.name ?? (e as { Code?: string })?.Code;
    if (name === "RestoreAlreadyInProgress") return;
    throw e;
  }
}

// The gate helper both portal routes call before signing.
export async function resolveOrRestore(
  key: string,
): Promise<{ status: "available" } | { status: "restoring"; justInitiated: boolean }> {
  const state = await headObjectRestore(key);
  if (state === "available") return { status: "available" };
  if (state === "restoring") return { status: "restoring", justInitiated: false };
  await initiateRestore(key);
  return { status: "restoring", justInitiated: true };
}
```
- [ ] **Step 4 — run, expect PASS:** `pnpm test src/lib/s3.test.ts`; `pnpm typecheck`.
- [ ] **Step 5 — commit.**

---

## Task 3 — Wire both routes + preparing copy  *(WEIGHT: medium — subagent + review)*

**Files:** modify `src/app/api/portal/download/route.ts`, `src/app/api/portal/screener/route.ts`, `src/lib/portal.ts`.

- [ ] **Step 1 — copy:** update `PORTAL_COPY.errorPreparing` in `src/lib/portal.ts` to state the window + retry, e.g. `"We're retrieving this file from cold storage — this usually takes about 3–5 hours. Return to this link and it will be ready."` (calm/declarative; no banned words).
- [ ] **Step 2 — download route:** after `const row = ...` / the `403` guard and **before** `signAssetUrl`, insert the restore gate. Import `resolveOrRestore` from `@/lib/s3`.
```ts
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      // best-effort provenance — a log failure must NOT convert "preparing" into an error
      await admin.from("portal_access_events").insert({
        link_id: row.link_id, session_id: row.session_id, event_type: "restore_requested",
      });
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }
  // ...existing signAssetUrl + download-event log + return unchanged...
```
- [ ] **Step 3 — screener route:** same gate after its `403` guard and before `signAssetUrl(row.storage_key, PORTAL.screenerStreamTtlSeconds)`:
```ts
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      await admin.from("portal_access_events").insert({
        link_id: row.link_id, session_id: row.session_id, event_type: "restore_requested",
      });
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }
  // ...existing sign(6h) + return unchanged...
```
- [ ] **Step 4 — verify:** `pnpm typecheck && pnpm build`. Confirm the client already maps 409 → `PORTAL_COPY.errorPreparing` (download flow's `download()` and `screener-room.tsx` on-mount both do — no client change needed).
- [ ] **Step 5 — commit.**

---

## Task 4 — Infra doc + verification + final review  *(WEIGHT: light — inline; then whole-branch review + PR)*

- [ ] **Step 1 — infra doc:** append to `docs/infra/asset-portal-setup.md` a "Glacier restore (Portal-3)" section: the **`s3:RestoreObject`** IAM statement to add (alongside existing Get/Put; still no Delete); a note that the **90-day masters→Glacier-Flexible lifecycle policy is founder infra** (S3 lifecycle config, not code) that Portal-3 assumes; Standard tier + `Days=7` cost note; and the manual e2e:
  - force a master to Glacier (or wait out the lifecycle) → open its portal link → first access returns "preparing" + a `restore_requested` event lands → S3 shows a restore in progress → after ~3–5h the same link serves/plays it → a second access during the window launches **no** new retrieval.
- [ ] **Step 2 — full suite:** `supabase test db`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` — all green.
- [ ] **Step 3 — leak-check:** confirm the new S3 calls are server-only (no `@aws-sdk`/`s3`/restore fns in the client bundle).
- [ ] **Step 4 — commit; then whole-branch review (opus) + PR** (stacked on `portal-2-screener-room`).

## Self-Review (against the spec)
- **Coverage:** HEAD-as-truth detection (T2 `parseRestore`/`headObjectRestore`) · auto-on-access Standard restore, idempotent (T2 `initiateRestore`/`resolveOrRestore`) · route wiring + 409 (T3) · `restore_requested` provenance, best-effort (T1 enum + T3 insert) · retry-driven (no poller) · copy (T3) · IAM/lifecycle doc + manual e2e (T4). Deferred seams (pre-warm/notify/Expedited) documented, not built.
- **Type consistency:** `resolveOrRestore` return shape matches both routes' usage; `RestoreState` used by `parseRestore`/`headObjectRestore`; `restore_requested` enum value matches the `portal_access_events` insert (regenerated types).
- **Rule checks:** storage_key stays server-side; `restore_requested` append-only; assets untouched (no restore column); restore-log failure does not convert a "preparing" into a 500.
