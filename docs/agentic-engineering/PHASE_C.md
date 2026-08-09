# Agentic Engineering — Phase C notes

Companion to `AGENTIC_ENGINEERING_V1.md`, `PHASE_A.md`, and `PHASE_B.md`. Does not replace the architecture.

## What becomes live in Phase C

- Authenticated GitHub **reads** for repo metadata, Issue comments, PRs, checks, reviews
- Live founder-authorization verification against real comment metadata
- Supervised bootstrap of the real `ae/control` branch (explicit `--apply`)
- Protection **preflight** (read/verify/report)
- Constrained **CAS writes** to `ae/control` only (Git Data API: blob → tree → commit → ref)
- Supervised CLI: `pnpm ae:control`
- Evidence ingestion helpers mapping live GitHub data into Phase A closure fields

## What remains manual

- Creating/adjusting repository rulesets (Phase C verifies; does not auto-mutate by default)
- Founder merge of implementation PRs
- Production mutation / destructive DB execution
- Approving any live write smoke test against the real repository
- Choosing and installing the GitHub App (or issuing a fine-grained PAT)

## What remains impossible (still out of scope)

- Unattended Cursor/Codex agents
- Autonomous remediation loops
- Slack
- Autonomous merge
- Production AWS/Vercel/Supabase mutation
- Force-push / history rewrite on `ae/control`
- Writes to `main` or application feature branches via AE control-writer APIs

## GitHub credential model

Environment (secret values never committed; never printed):

| Variable | Role |
|---|---|
| `AE_GITHUB_TOKEN` | Bearer token for API calls (fine-grained PAT or App installation token) |
| `AE_GITHUB_OWNER` | Repository owner (optional if inferred from config) |
| `AE_GITHUB_REPO` | Repository name |
| `AE_CONTROL_BRANCH` | Defaults to `ae/control` |
| `AE_FOUNDER_GITHUB_ACTOR_ID` | Defaults to `40549435` |

Preferred production shape: GitHub App installation token with narrow permissions, minted
out-of-band and supplied as `AE_GITHUB_TOKEN` for the supervised process.

Capability classes are conceptual — GitHub cannot perfectly path-scope pushes. Enforcement
layers: token least-privilege + ruleset + local protected-delta/CAS validation.

## Control branch semantics

- Tip for CAS = **git commit SHA** of `refs/heads/ae/control`
- Objects = UTF-8 path → bytes for grammar-valid control paths only
- Allowlisted metadata files (`CONTROL_PLANE.md`, `.ae-control-bootstrap`) may exist but
  are not authority objects
- Bootstrap uses an **orphan commit** (`parents: []`) so control history is not entangled
  with application `main` history
- Writes: build candidate locally → validate delta/chain/fold → create blobs/tree/commit →
  update ref with `force=false` only if tip still equals expected

## Authorization-event verification

Live verify requires fetching the Issue comment and checking:

1. Comment exists on the expected repository
2. Actor numeric ID == configured founder ID
3. Body parses with Phase A `AE-AUTHORIZE` grammar
4. Exact task / version / digest / base SHA match expectations
5. `created_at === updated_at` (edited authorization rejected)
6. Caller-supplied pasted body is not authoritative once live verification is used

Verified evidence feeds Phase B `bindFounderAuthorization`.

## Control-write trust boundary

Public API exposes constrained transactions only. Raw Git tree/ref mutation is internal.
No automatic retry on stale tip. No force update.

## Operational commands

```text
pnpm ae:control -- help
pnpm ae:control github-read ...
pnpm ae:control verify-founder-authorization ...
pnpm ae:control control-status
pnpm ae:control control-bootstrap --dry-run
pnpm ae:control control-bootstrap --apply
pnpm ae:control control-append --dry-run ...
pnpm ae:control control-append --apply ...
pnpm ae:control pr-evidence --pr <n>
pnpm ae:control protection-preflight
```

Mutating commands default to dry-run; `--apply` required for writes.

## Recovery model

- Stale tip → fail closed; operator re-reads and re-proposes
- Integrity violation → no write; founder recovery per architecture §4.5.7
- Never force-push `ae/control` from Phase C tooling

## Check identity limitation

GitHub Actions required checks are often ruleset-bound by **name**. Phase C records
check-run ID, app/creator, name, SHA, conclusion, and timestamps where exposed so later
phases can strengthen spoof resistance. Until rulesets use stronger identity, name
collision remains a documented residual risk.

## Founder checkpoints before live write activation

Do not infer YES without repository evidence. As of Phase C implementation completion:

| Checkpoint | Status |
|---|---|
| real `ae/control` branch exists | **NO** (API 404) |
| `ae/control` protection verified | **UNKNOWN/NO** (branch absent; rulesets not confirmed for this branch) |
| founder actor ID configured | **YES** (code default `40549435`) |
| credential model chosen | **Documented** (App installation token preferred; `AE_GITHUB_TOKEN`) — installation pending founder |
| credential permissions verified | **PENDING** |
| writer cannot merge | **PENDING** (token + ruleset evidence required) |
| writer cannot push main | **PENDING** |
| writer cannot alter rulesets | **PENDING** |
| recovery path documented | **YES** (this note + plan; never force-push from Phase C tooling) |
| live write smoke test authorized | **NOT AUTHORIZED** |

Supervised bootstrap (`pnpm ae:control -- control-bootstrap --apply`) creates the branch
only when the founder explicitly runs it with credentials. Protection ruleset creation
remains a separate founder configuration step; Phase C preflight reports UNKNOWN rather
than claiming safety.
