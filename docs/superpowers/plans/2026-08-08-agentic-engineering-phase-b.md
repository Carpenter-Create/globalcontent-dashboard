# Agentic Engineering Phase B — Implementation Plan

> **For agentic workers:** Local/dry-run control-plane mechanics only. No unattended
> GitHub Actions, no real `ae/control` branch creation, no write tokens, no Slack,
> no agent routing, no production access.

**Goal:** Bridge Phase A pure domain primitives to supervised local control-ledger
operations: repository abstraction, frozen contract staging, founder authorization
binding, append-only event writes with CAS, state reconstruction, SHA-pin helpers,
dry-run CLI, and a non-activated GitHub boundary interface.

**Source of truth:** `docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md` (approved).
**Phase A foundations:** `src/lib/agentic-engineering/` (merged; do not fork).

**Tech:** TypeScript strict, existing `zod`, Node `crypto`, Vitest, Vite SSR loader for
CLI (via Vitest’s existing Vite dependency). **No new package dependencies.**

## Scope

### In scope

- Control-plane path/layout abstraction (Phase A grammar)
- In-memory + filesystem control-store adapters
- Contract stage / freeze dry-run
- Founder `AE-AUTHORIZE` binding (actor ID `40549435`)
- Append-only event writer with pre-write integrity + expected-tip CAS
- Global single-writer tip model (pure/local)
- State reconstruction via Phase A fold
- SHA-pin event helpers
- Supervised dry-run CLI
- GitHub boundary interface (local/unimplemented only)
- Docs + tests

### Explicit exclusions (Phase C+)

- Creating/protecting real `ae/control`
- GitHub Actions orchestration / automatic ruleset mutation
- Authenticated GitHub writes / Issue mutations
- Cursor/Codex routing, Slack, autonomous merge
- Production credentials / cloud access / destructive ops
- Application schema/migrations / dashboard behavior

## Files

| Path | Responsibility |
| --- | --- |
| `docs/superpowers/plans/2026-08-08-agentic-engineering-phase-b.md` | This plan |
| `docs/agentic-engineering/PHASE_B.md` | Implementation notes |
| `src/lib/agentic-engineering/control-store.ts` | Store interface + tip hashing |
| `src/lib/agentic-engineering/memory-control-store.ts` | In-memory CAS adapter |
| `src/lib/agentic-engineering/filesystem-control-store.ts` | Local FS adapter |
| `src/lib/agentic-engineering/control-ledger.ts` | Stage/freeze/append/CAS orchestration |
| `src/lib/agentic-engineering/authorize-binding.ts` | Founder authorize dry-run binder |
| `src/lib/agentic-engineering/reconstruct-state.ts` | Task reconstruction |
| `src/lib/agentic-engineering/sha-pin-events.ts` | SHA-pin payload helpers |
| `src/lib/agentic-engineering/github-boundary.ts` | Future GH interface + local stub |
| `src/lib/agentic-engineering/dry-run-cli.ts` | CLI command dispatcher |
| `scripts/agentic-engineering/dry-run.mjs` | Supervised entry (Vite SSR load) |
| `*.test.ts` | Coverage |

## Control-plane model

Conceptual `ae/control` layout (local adapter only):

- `contracts/<task_id>/vN.yaml` — create-once authority
- `events/<task_id>/<6-digit>-<type>.json` — append-only authority
- `closures/<task_id>/<40-hex>.md` — derived
- `proposed/<task_id>/vN.yaml` — staging / derived

Writes require: expected tip == observed tip, protected-delta OK, event-chain OK.

## Dry-run boundaries

- No network GitHub calls
- No real branch/ref updates outside local store adapters
- GitHub boundary methods that would mutate remotes throw / return not-activated
- Founder actor ID supplied as dry-run input; compared to configured `40549435`

## Validation

```bash
pnpm exec vitest run src/lib/agentic-engineering
pnpm typecheck
pnpm test
pnpm exec eslint src
pnpm build
git diff --check
```

## Rollback

Additive docs + modules under `src/lib/agentic-engineering/` and
`scripts/agentic-engineering/`. Revert by deleting those paths. Optional
`package.json` script `ae:dry-run` is harmless.

## Founder checkpoints (before live activation)

1. Create real `ae/control` branch
2. Configure branch/ruleset protection (no force-push/delete; founder + privileged orchestrator only)
3. Configure `FOUNDER_GITHUB_ACTOR_ID=40549435`
4. Choose privileged orchestrator credential model
5. Choose GitHub Actions vs supervised runner for Phase C/D
6. Confirm merge remains founder-only

Phase B does **not** activate these.
