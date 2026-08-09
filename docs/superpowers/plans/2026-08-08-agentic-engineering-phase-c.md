# Agentic Engineering — Phase C Implementation Plan

**Branch:** `feat/agentic-engineering-phase-c`  
**Base:** `1a6c89d52c4abc0be908f7c1bf8807069f9548aa`  
**Date:** 2026-08-08  
**Status:** implementation plan (companion to `docs/agentic-engineering/PHASE_C.md`)

## Scope

Connect Phase A/B domain mechanics to **real GitHub metadata** and a protected
`ae/control` branch. Supervised, least-privilege, founder-gated. No unattended agents.

### In scope

- Authenticated GitHub reads (repo, comments, PR, checks, reviews, control tree)
- Credential abstraction (App preferred; fine-grained PAT documented fallback)
- Live founder-authorization verification against real Issue comments
- Supervised `ae/control` bootstrap (`--dry-run` default, `--apply` required)
- Protection preflight (verify/report; default no ruleset mutation)
- Constrained CAS writes to `ae/control` only (Git Data API)
- PR/check/review evidence normalization into Phase A closure model
- Supervised CLI (`pnpm ae:control`)
- Fake-adapter unit tests (no live GitHub in CI)

### Out of scope (Phase D+)

- Unattended implementer/reviewer agents
- Slack, autonomous merge, production mutation
- Automatic remediation loops
- Privileged workflow execution of untrusted PR code
- Automatic ruleset mutation (founder checkpoint)

## Live GitHub read boundary

Reads may use a **read credential** with minimal scopes: contents, metadata, issues,
pull requests, checks. Never log tokens. Timeouts + rate-limit handling + fail closed.

## Live control-branch write boundary

Writes use a **control-writer credential** and may only:

1. Create blobs for new allowed paths
2. Create a new tree preserving all prior protected blobs
3. Create a commit with parent = expected tip
4. Update `refs/heads/ae/control` with `force=false`

No force-push, no main writes, no settings mutation, no merge API.

## Credential model

| Class | Purpose | Must not |
|---|---|---|
| Read | Metadata + evidence | Write refs |
| Control-writer | `ae/control` CAS only | Merge, push main, admin, secrets |

Preferred: GitHub App installation token. Fallback: fine-grained PAT via `AE_GITHUB_TOKEN`.
Classic PAT is not the default recommendation.

Residual risk: GitHub cannot path-scope push tokens perfectly — branch ruleset + local
validation remain mandatory.

## Bootstrap sequence

1. Preflight: expected repo, no existing `ae/control` (or exact expected empty state)
2. Dry-run preview of tree + base strategy
3. `--apply`: create **orphan commit** (`parents: []`) containing only allowlisted
   control-plane bootstrap files + empty control object set
4. Create `refs/heads/ae/control` at that commit (non-force)
5. Founder separately configures ruleset protection (Phase C verifies, does not invent)

## Fail-closed behavior

- Unknown paths on control tree → reject
- Tip mismatch / stale tip → no write
- Edited authorize comment → reject
- Protection UNKNOWN → do not claim writes are safe
- Integrity / chain / fold failure → no write

## Rollback / recovery

- Never force-push `ae/control`
- Stale tip → re-read, reconstruct, re-propose (manual; no auto-retry in Phase C)
- Integrity violation → founder recovery only (architecture §4.5.7)

## Founder checkpoints

Before treating live writes as activated:

1. `ae/control` exists
2. Protection verified (not UNKNOWN)
3. Founder actor ID configured (`40549435`)
4. Credential model chosen + permissions verified
5. Writer cannot merge / push main / alter rulesets
6. Recovery path documented
7. Live write smoke test explicitly authorized (if any)

## Phase D+ exclusions

Agent routing, Slack, autonomous merge, production access, unattended remediation.
