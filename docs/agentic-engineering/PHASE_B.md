# Agentic Engineering — Phase B notes

Companion to `AGENTIC_ENGINEERING_V1.md` and `PHASE_A.md`. Does not replace the architecture.

## What Phase B adds

Supervised **local/dry-run** control-ledger mechanics on top of Phase A primitives:

- Repository-like `ControlStore` (memory + filesystem adapters)
- Contract staging (`proposed/`) and freeze (`contracts/`)
- Founder authorization binding (`AE-AUTHORIZE` + actor ID + digest + base SHA)
- Append-only event writer with protected-delta + chain checks
- Expected-tip CAS (no silent retry)
- Task state reconstruction via Phase A `foldTaskState`
- SHA-pin event payload helpers
- Dry-run CLI (`pnpm ae:dry-run`)
- GitHub boundary **interface** (not activated)

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

## Authorization binding

`bindFounderAuthorization` (dry-run inputs only):

1. Parse exact `AE-AUTHORIZE` grammar (Phase A)
2. Require `observedFounderActorId === CONFIGURED_FOUNDER_GITHUB_ACTOR_ID` (40549435)
3. Require `commentAction === "created"` (edited rejected)
4. Recompute staged contract digest; require exact version/digest/base SHA match
5. Freeze create-once `contracts/<task>/vN.yaml`
6. Append strict `authorize` event via CAS writer

## CAS / integrity

Before any write:

1. Observe current tip; require equals `expectedTip`
2. Verify protected delta (no modify/delete of prior authority objects)
3. Verify existing event chain for the task
4. Build next event (sequence, prev digest, active contract pins, event digest)
5. Validate schema + proposed delta
6. `compareAndSwap(expectedTip, nextObjects)` — stale tip → structured failure, no retry

## Manual founder actions still required (do not auto-activate)

Before any live control-plane activation:

1. Create the real `ae/control` branch
2. Configure branch/ruleset protection (no force-push/delete; founder + privileged orchestrator only)
3. Configure repository variable `FOUNDER_GITHUB_ACTOR_ID=40549435`
4. Choose privileged orchestrator credential model
5. Choose GitHub Actions vs supervised runner for Phase C/D
6. Confirm merge remains founder-only

Phase B implements only local/dry-run mechanics and the GitHub boundary interface.
