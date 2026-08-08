# Agentic Engineering Phase A — Implementation Plan

> **For agentic workers:** Pure local/domain foundation only. No orchestration, no GitHub
> writes, no `ae/control` branch, no workflows, no Slack.

**Goal:** Ship machine-validatable contract/event schemas, digest/integrity primitives,
authorize-comment grammar, event-chain + protected-delta verifiers, deterministic state
fold, and a pure closure-readiness predicate — with comprehensive Vitest coverage.

**Source of truth:** `docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md` (approved).

**Tech:** TypeScript strict, existing `zod`, Node `crypto` (SHA-256), Vitest. **No new
dependencies.**

## Out of scope (explicit)

- Creating/configuring the real `ae/control` branch or rulesets
- GitHub Actions / privileged tokens / write APIs
- Slack, Cursor/Codex routing, autonomous merge
- Application behavior, schema/migrations, production access
- Network I/O of any kind from Phase A modules

## Files to add

| File | Responsibility |
| --- | --- |
| `docs/superpowers/plans/2026-08-08-agentic-engineering-phase-a.md` | This plan |
| `docs/agentic-engineering/PHASE_A.md` | Digest/canonicalization/genesis/fold notes (not a second architecture) |
| `src/lib/agentic-engineering/*` | Pure schemas + primitives + tests |

No application routes, workflows, or `package.json` changes.

## Validation strategy

```bash
pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build
git diff --check
pnpm exec vitest run src/lib/agentic-engineering
```

Mutation-style negatives in tests so each important assertion can fail.

## Rollback / reversibility

All changes are additive docs + a new `src/lib/agentic-engineering/` tree. Revert by deleting
those paths. No DB, no env, no deploy coupling.

## No-production-impact statement

Phase A cannot affect production: no network, no credentials, no control branch, no
workflows, no app import sites required. Modules are unused by the running dashboard until
later phases wire them.
