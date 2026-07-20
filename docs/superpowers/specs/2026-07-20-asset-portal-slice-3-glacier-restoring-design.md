# Asset-access portal — Slice 3: Glacier restoring — design (slice Portal-3)

> Status: design pending approval. Third slice of the asset-access portal. Turns the *placeholder*
> 409 "preparing" branch (Portal-1/2) into a real Glacier-restore flow: detect an archived master,
> initiate a Standard restore, show an honest "preparing (~3–5h)" state, and serve once S3 reports the
> temp copy available. Builds on Portal-1 (PR #13) + Portal-2 (PR #14). Source of truth for *what*:
> `docs/domain-spec.md` §12/§15 + golden rule 14 + the CLAUDE.md note "Masters go to Glacier Flexible
> at 90 days (lifecycle policy, not code) … Restore takes 5–12h, so delivery needs a `restoring`
> state." This doc is the *how* for Portal-3.

## Context

Masters are tiered to **Glacier Flexible Retrieval at 90 days** by an S3 **lifecycle policy** — founder
infra, **not code** (Portal-3 assumes it and documents it; it does not create it). Only masters are
Glaciered (not artwork/captions/screeners). So a portal access to a master's bytes can hit an archived
object: **master downloads** (Portal-1) and **master-source screeners** (Portal-2 when
`titles.screener_source = master`). Dedicated screeners (S3 Standard) and fresh masters never hit it.

Today both routes have a 409 "preparing" branch, but it is a **placeholder** — `signAssetUrl` only
throws on missing env, never on S3 object state, so a Glaciered master would be signed into a URL that
then 403s at CloudFront (the reviewer flagged this in both slices). Portal-3 makes the check real: a
**HEAD on the object is the source of truth** for its storage class + restore status; the route acts on
it before signing.

## Scope

**In:**
- **`headObjectRestore(storageKey)`** (`s3.ts`, server-only) — HEAD the object, return
  `{ storageClass, restore: "none" | "restoring" | "available" }` parsed from the `x-amz-restore`
  header (`ongoing-request="true"` → restoring; `ongoing-request="false"` + `expiry-date` → available;
  header absent on an archived object → none).
- **`initiateRestore(storageKey)`** (`s3.ts`) — `RestoreObjectCommand`, `GlacierJobParameters.Tier =
  "Standard"`, `Days = 7`. Idempotent: `RestoreAlreadyInProgress` is treated as success.
- **`resolveOrRestore(storageKey)`** — shared helper: not-archived / restore-available → `{status:
  "available"}`; archived + in-progress → `{status:"restoring", justInitiated:false}`; archived + no
  restore → fire `initiateRestore` → `{status:"restoring", justInitiated:true}`.
- **Route wiring:** `/api/portal/download` and `/api/portal/screener` call `resolveOrRestore` after the
  resolve RPC, before signing. `restoring` → 409 "preparing"; `available` → sign + serve. On
  `justInitiated`, log a `restore_requested` `portal_access_events` row (link_id + session_id from the
  resolve RPC).
- **Migration:** `ALTER TYPE public.portal_event ADD VALUE 'restore_requested'` (isolated migration).
- **Pure parser** for `x-amz-restore` → Vitest.
- **"Preparing" copy** updated to state the ~3–5h window + that the retrieval has started and they can
  return to the same link.
- Infra doc: the `s3:RestoreObject` IAM addition + the (founder-owned) 90-day lifecycle policy.

**Out (seams — designed, not built):**
- **GC pre-warm** — a "Restore now" button on the GC side reusing `initiateRestore`; deferred.
- **Notify-when-ready** — email the recipient when the restore completes; needs an `asset_restores`
  table + a poll cron (deliberately not built — retry-driven for v1).
- **Expedited tier** — a GC-selected faster/pricier option; deferred (Standard is the auto default).
- **The lifecycle transition policy itself** — founder infra, documented, not created here.

## Key decisions (from the design dialogue)

- **Auto-on-access trigger** (GC pre-warm later): the access that finds an archived master initiates the
  restore. Safe — gated behind a valid link + OTP session; `RestoreObject` is idempotent so repeat hits
  don't stack cost.
- **Standard retrieval tier (~3–5h)** — founder-chosen balance of cost vs latency; the "preparing" copy
  states that window. (Bulk 5–12h cheaper but rough UX; Expedited minutes but ~10× and better as the
  later GC pre-warm option.)
- **HEAD-as-truth, no new table** — S3 is authoritative for storage class + restore status; the gate
  reads it live each access. Provenance is a `restore_requested` value on the existing append-only
  `portal_access_events` (assets stay immutable, rule 3). A dedicated `asset_restores` table earns its
  place only when GC pre-warm / notify-when-ready land.
- **Retry-driven ready-detection** — the recipient returns to the same link; each access re-HEADs until
  it serves. No background poller in the core flow.
- **No proactive notify in v1** — the "preparing" page sets the ~3–5h expectation; email-when-ready is a
  documented seam.

## Data flow

Both routes, after their resolve RPC returns `storage_key` + `link_id` + `session_id`:
```
const r = await resolveOrRestore(storage_key)
if (r.status === "restoring") {
  if (r.justInitiated) await admin.from("portal_access_events").insert({
    link_id, session_id, event_type: "restore_requested" })
  return 409 { error: "preparing" }
}
// r.status === "available"
url = signAssetUrl(storage_key[, screenerStreamTtlSeconds])
... (download: log download + return; screener: return)
```
`resolveOrRestore` HEADs once per route call (download click / screener mount) — cheap, and the screener
signs a 6h URL so playback doesn't re-HEAD per range request.

## Enforcement / behavior notes

- **Idempotent + no cost stacking:** `initiateRestore` only fires when HEAD shows archived + no ongoing
  restore; a concurrent/duplicate call returns `RestoreAlreadyInProgress`, caught and treated as
  `restoring`. So repeat accesses during the 3–5h window don't launch new retrievals.
- **`Days=7`:** the restored copy stays on Standard for 7 days, then reverts to Glacier-only; a later
  access re-restores. Reasonable for a delivery/pitch window.
- **Only masters:** the helper is called by both routes for whatever `storage_key` the resolve RPC
  returns; for a non-archived object (dedicated screener, fresh master) HEAD returns a normal storage
  class → `available` immediately (one cheap HEAD, no restore). No kind-specific branching needed.
- **Rule 14 preserved:** the storage_key never leaves the server; HEAD/restore/sign are all server-side.
- **Provenance (rule 5):** `restore_requested` is append-only, captures who (session) / which link / when.

## Verification

- **Vitest:** the `x-amz-restore` parser — `ongoing-request="true"` → restoring; `ongoing-request="false",
  expiry-date="…"` → available; absent → none; and the storage-class mapping (GLACIER/DEEP_ARCHIVE →
  archived, STANDARD → not). `resolveOrRestore`'s branching with a mocked head/restore.
- **pgTAP:** `portal_event` enum includes `restore_requested`; a `restore_requested` row inserts
  (service-role) and UPDATE/DELETE stay revoked (append-only holds).
- **Manual e2e (post-provisioning, needs a truly Glaciered object):** force a master to Glacier (or wait
  out the lifecycle) → open its portal link → first access returns "preparing" + a `restore_requested`
  event is logged + a restore is visibly in progress in S3 → after ~3–5h, the same link serves the
  master (download) / plays it (screener). Confirm a second access during the window does NOT launch a
  new retrieval.
- `typecheck` / `lint` / `build` green; `leak-check` (the new S3 calls are server-only).

## Seams left clean

- **GC pre-warm** and **notify-when-ready** both build on `headObjectRestore`/`initiateRestore` +
  `restore_requested`; notify adds an `asset_restores` table + a poll cron.
- **Expedited tier**: `initiateRestore` takes the tier as a parameter (default Standard) so a GC option
  is a call-site change.
- The **409 "preparing" contract** in both routes is now real; any future storage tier plugs into
  `resolveOrRestore`.

## Dependency & branching

Stacks on `portal-3` → `portal-2-screener-room` (PR #14) → `portal-1-master-download` (PR #13). Authored
on `portal-3-glacier-restoring`; rebase if #13/#14 change. Do not merge before them. **Provisioning gate:**
`s3:RestoreObject` IAM permission + the 90-day lifecycle policy must be in place before the manual e2e.
