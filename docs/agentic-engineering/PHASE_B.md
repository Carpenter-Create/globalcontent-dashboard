# Agentic Engineering — Phase B notes

Companion to `AGENTIC_ENGINEERING_V1.md` and `PHASE_A.md`. Does not replace the architecture.

**Status:** merged to `main` via PR #101. Remains valid as **local/dry-run** control-ledger
mechanics only. Does **not** activate live GitHub control writes. Phase C experimental
implementation was abandoned unmerged — do not treat Phase B as permission to resume it
(see `docs/status/CURRENT.md`).

## What Phase B adds

Supervised **local/dry-run** control-ledger mechanics on top of Phase A primitives:

- Repository-like `ControlStore` (read) + internal `MutableControlStore.unsafeCompareAndSwap` (ledger writer only)
- Dedicated marked filesystem ledger (`.ae-control-ledger`) with realpath confinement, symlink rejection, exclusive lock, temp publish
- Constrained transactions: `stageContract`, `bindFounderAuthorization`, `appendControlEvent` (operational only), founder record APIs, `addDerivedClosure`
- Fold-before-write + protected-delta + event-chain + create-once
- Active contract pins derived from verified chain (claimed pins must match)
- Staged-store provenance for authorize; frozen-contract authority for AUTHORIZED+ reconstruction
- Dry-run CLI (`pnpm ae:dry-run`)
- GitHub boundary **interface** (not activated; no raw CAS)

## What remains dry-run

- No real `ae/control` branch
- No GitHub network writes / Issue mutations
- No Actions orchestration or ruleset automation
- No Slack, agent routing, merge, or production access

## Protected control state model

A `ControlStore` holds:

- opaque **tip** string (content-addressed digest of the object set)
- path → UTF-8 bytes for control-plane paths

Authority paths (`contracts/**`, `events/**`) are create-once. Derived paths
(`proposed/**`, `closures/**`) may refresh. Unknown paths fail closed (Phase A grammar).

Filesystem ledgers are dedicated directories only — never repo root, `/`, home, or arbitrary non-empty trees. Corruption (tip mismatch, symlinks, unknown paths, missing tip) fails closed; tip is never auto-rewritten.

## Authorization binding

`bindFounderAuthorization` (dry-run inputs only):

1. Parse exact `AE-AUTHORIZE` grammar (Phase A)
2. Require `observedFounderActorId === CONFIGURED_FOUNDER_GITHUB_ACTOR_ID` (40549435)
3. Require `commentAction === "created"` (edited rejected)
4. Load staged bytes from store proposed path only (no caller YAML substitute)
5. Recompute digest; require exact version/digest/base SHA match
6. Freeze create-once `contracts/<task>/vN.yaml`
7. Append strict `authorize` via privileged commit path

## Privileged vs operational events

Generic `appendControlEvent` / CLI `append-event` reject privileged types
(`authorize`, `finding_disposition`, `founder_review_ready`, `closed`, `paused`,
`resumed`, `cancelled`, `contract_staged`). Use dedicated APIs.

## CAS / integrity

Before any write:

1. Observe current tip; require equals `expectedTip`
2. Verify protected delta (no modify/delete of prior authority objects)
3. Verify existing event chain for the task
4. Build next event (sequence, prev digest, derived active contract pins, event digest)
5. Validate schema + proposed delta + full next chain
6. `foldTaskState` over proposed chain — reject before CAS if fold fails
7. Internal `unsafeCompareAndSwap` — stale tip → structured failure, no retry

## Manual founder actions still required (do not auto-activate)

Before any live control-plane activation:

1. Create the real `ae/control` branch
2. Configure branch/ruleset protection (no force-push/delete; founder + privileged orchestrator only)
3. Configure repository variable `FOUNDER_GITHUB_ACTOR_ID=40549435`
4. Choose privileged orchestrator credential model
5. Choose GitHub Actions vs supervised runner for Phase C/D
6. Confirm merge remains founder-only

Phase B implements only local/dry-run mechanics and the GitHub boundary interface.
