# Global Content Agentic Engineering v1

- **Status:** specification only — not implemented
- **Branch target for this doc:** `feat/agentic-engineering-v1`
- **Base at authoring:** `db0de83dfd7da483ded7233446df7da553c66233`
- **Audience:** founder + any engineer/agent implementing the orchestration system
- **Authority:** This document defines *coordination automation*. It does not override
  `AGENTS.md`, `CLAUDE.md`, `docs/domain-spec.md`, or `docs/HANDOFF.md`. Where those
  conflict with convenience, those win.

---

## 0. Repository evidence this design is built on

This spec was designed against the operating model already in the repo, not invented
in isolation. Implementers must treat these as binding inputs:

| Source | What it contributes |
| --- | --- |
| `AGENTS.md` / `CLAUDE.md` | Working contract, founder checkpoints, destructive-ops rule, verification discipline, secrets rules, golden rules |
| `docs/HANDOFF.md` | Live hard rules, production migration gating, “verification that cannot fail” lesson, Cursor/Codex independent review practice |
| `docs/domain-spec.md` | Domain truth; open founder decisions must not be invented |
| `.github/workflows/ci.yml` | `checks` + `isolation`; `isolation` is the required status check on `main` |
| `.github/workflows/migration-drift.yml` | Threat-aware secret design: no PR trigger for secret-bearing jobs; least-privilege `drift_reader`; fail closed on empty/unknown results |
| `.codex/config.toml` + `.codex/hooks.json` + `.codex/hooks/guard-destructive.sh` | Secrets deny + destructive-command backstop (seatbelt, not licence) |
| `.github/CODEOWNERS` | Structural ownership; founder `@acarpcreate`; enables “require Code Owners review” later |
| `docs/superpowers/specs|plans|ledgers/*` | Existing bounded-work pattern: design → plan → execution ledger with SHA-pinned implement/review/fix rounds |

**Reuse, do not duplicate:**

- **Spec / plan / ledger triad** already governs bounded engineering (screener-proxy is the
  reference). Agentic Engineering v1 adds a *machine-readable task contract + state machine*
  around that triad; it does not replace design docs or ledgers.
- **Fix-round counters** already appear in ledgers as `fix round N/5`. v1 codifies that limit.
- **Founder process note (2026-08-07, screener-proxy ledger):** full review loops stay on
  database changes and publicly reachable endpoints; ordinary code may receive one review pass
  rather than endless fix/re-review. v1 encodes that as review-intensity policy, not as a
  weakening of independent review.

---

## 1. Purpose

### Problem

Today the founder is often the transport layer between tools:

```
ChatGPT defines work
  → Cursor implements
  → founder copies result
  → Codex reviews
  → founder copies findings
  → Cursor remediates
  → founder copies result
  → Codex re-reviews
  → founder checks CI / PR state
  → founder decides whether to merge
```

That coordination cost is the target of automation. Product authority is not.

### Objective

Reduce manual founder coordination between ChatGPT, Cursor, Codex, and GitHub for
**bounded engineering slices**, while preserving human authority over costly, irreversible,
product, architectural, production, and founder-gated decisions.

### Acceptance criterion

> Once the founder authorizes a bounded engineering slice, the founder should be able to
> walk away. No further founder interaction should be required until the system reaches a
> legitimate founder gate, becomes materially blocked, or encounters a critical failure.

### Non-goals for this document

- Implementing orchestration code
- Adding dependencies
- Creating GitHub Actions workflows
- Adding Slack integration
- Changing application behavior, schema, or migrations
- Invoking production systems

---

## 2. Design principles

1. **GitHub remains the canonical code and PR system of record.** Branches, commits, PRs,
   checks, and merge state are authoritative for code motion.
2. **`AGENTS.md`, repository docs, tests, and CI are authoritative governance inputs.**
   The orchestrator routes work; it does not reinterpret doctrine into softer rules.
3. **Implementer and reviewer are separate roles.** The same agent identity must not fill
   both roles on the same task without an explicit founder exception recorded on the task.
4. **Review inspects the actual diff/commit**, never only an implementer summary. Ledgers
   already show summary overclaim; the protocol assumes that failure mode.
5. **Founder checkpoints in `AGENTS.md` remain binding.** Pricing/packaging/money,
   branding/naming/copy/visual decisions, data deletion / destructive migrations, external
   communications, final architecture & launch calls.
6. **Production mutation remains founder-gated.** Applying migrations, AWS production
   changes, spend, and production validation are never agent-autonomous.
7. **Destructive operations remain prohibited for agents** unless a task explicitly records
   `destructive_ops_allowed: false` (default) or a founder-approved exception path that still
   requires founder *execution* for apply. Writing SQL in a PR ≠ applying it.
8. **Security/isolation controls may not be weakened to make automation easier.** Never add
   `KNOWN_OPEN` baseline entries to greenwash CI (`docs/HANDOFF.md`). Never convert a failed
   check into a pass to keep the workflow moving.
9. **Fail closed** when authority or state is ambiguous.
10. **Automation must not silently reinterpret repository doctrine.**
11. **A failed automated check is never converted into “pass”** merely to keep motion.
12. **Every transition leaves an audit trail** of who/what performed it, on which SHA, with
    what evidence.

---

## 3. Roles

### 3.1 Founder

Authority for:

- authorizing a bounded task contract
- founder checkpoints (`AGENTS.md`)
- phase progression of Agentic Engineering itself
- production mutation and production validation
- material architecture / product decisions
- merge authorization to `main` (v1: always founder-executed or founder-approved)
- resolving `BLOCKED` / `CRITICAL_FAILURE` / material agent disagreement

The founder is *not* required as a message courier between Implementer and Reviewer.

### 3.2 Orchestrator

Owns task-state transitions and routing.

Does:

- validate that a transition’s required evidence exists
- assign/route Implementer and Reviewer work
- observe CI and validation results
- assemble closure packages
- notify the founder at legitimate gates
- stop at founder gates

Does not:

- independently reinterpret product requirements
- invent missing spec decisions
- implement application code unless explicitly acting under a declared Implementer role
  for that task (discouraged in v1; prefer separate implementer)
- approve its own governance changes
- merge to `main` autonomously
- apply migrations or mutate production

### 3.3 Implementer

Executes the authorized bounded slice on the work branch.

May:

- implement within `authorized_scope`
- remediate reviewer findings **within authorized scope**
- open/update the task PR
- run local verification commands prescribed by `AGENTS.md`

Must not:

- expand scope without escalation to `FOUNDER_DECISION_REQUIRED` or `BLOCKED`
- apply migrations / run destructive DB ops / mutate AWS or Vercel production
- treat review as optional
- mark validation passed without runnable evidence

### 3.4 Independent Reviewer

Reviews the **actual commit/diff** at a pinned SHA against:

- authorized task contract (scope in/out)
- `AGENTS.md` / hard rules
- referenced domain/spec/plan requirements
- security/isolation boundaries
- test quality (including mutation-check discipline where claimed)
- regressions and scope creep
- implementation correctness

Must:

- obtain independent context (checkout/diff at SHA; read governing docs)
- produce structured findings (`Critical` / `Important` / `Minor` / `deferred`)
- pin `reviewed_sha`
- refuse to rubber-stamp implementer summaries

Must not:

- rely solely on implementer-authored summaries
- apply production changes
- expand into implementation except for explicitly allowed tiny mechanical fixes if the
  task policy says so (default: **no**; screener-proxy’s “coordinator fixed a cast”
  remains a human/coordinator exception, not the v1 default)

### 3.5 Validation / Closure — recommendation

**Recommendation: Validation / Closure is a deterministic orchestration function in v1,
not a separate agent.**

Why:

1. **Repository verification is already specified mechanically** —
   `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`, plus CI jobs
   `checks` and `isolation`. A second opinionated agent adds disagreement without adding
   authority.
2. **This repo’s recurring failure mode is “verification that cannot fail.”** Closure must
   observe concrete exit codes, check runs, and SHA pins — not narrate confidence.
3. **Independent qualitative judgment already belongs to the Reviewer.** Splitting a third
   agent creates another transport hop the founder is trying to eliminate.
4. **Fail-closed assembly is easier to make deterministic** than agentic: missing required
   check → not closable; `head_sha != reviewed_sha` → not closable; unresolved Critical →
   not closable.

Validation / Closure therefore:

- runs or observes required validation commands / CI
- verifies SHA pins and review freshness
- verifies task acceptance criteria checkboxes
- emits a **closure package** (machine fields + short human summary)
- transitions to `FOUNDER_REVIEW` only when closable; otherwise back to remediation,
  `BLOCKED`, or `CRITICAL_FAILURE`

A later phase may add an optional “closure auditor” agent; it is not required for v1.

---

## 4. Task state machine

### 4.1 Canonical states (v1)

Combined where clean:

| State | Meaning |
| --- | --- |
| `DRAFT` | Task contract being written; not actionable |
| `FOUNDER_AUTHORIZATION_REQUIRED` | Contract complete; waiting for founder authorize |
| `AUTHORIZED` | Founder authorized; ready to route implementation |
| `IMPLEMENTING` | Implementer working |
| `VALIDATING` | Deterministic validation after implement or remediate |
| `REVIEWING` | Independent reviewer examining pinned implementation SHA |
| `REMEDIATION_REQUIRED` | Review findings require changes inside scope |
| `REMEDIATING` | Implementer addressing findings |
| `FOUNDER_REVIEW` | Closure package ready; founder action needed to accept/merge path |
| `FOUNDER_DECISION_REQUIRED` | Ambiguity / checkpoint / policy exception needs founder judgment |
| `BLOCKED` | Cannot proceed without external input or precondition |
| `CRITICAL_FAILURE` | Safety/integrity failure; stop |
| `PAUSED` | Explicit pause by founder |
| `CLOSED` | Terminal success (merged or explicitly accepted without merge if docs-only policy says so) |
| `CANCELLED` | Terminal abandonment |

**Intentionally omitted as separate states:**
`VALIDATING_IMPLEMENTATION` / `REVALIDATING` → single `VALIDATING` with
`validation_context: after_implement | after_remediate` on the task record.

### 4.2 Terminal states

- `CLOSED`
- `CANCELLED`

`CRITICAL_FAILURE` and `BLOCKED` are **not** terminal by default; they require founder
disposition (`PAUSED`, `CANCELLED`, re-authorize, or resume path).

### 4.3 Transitions

| From | To | Owner | Automatic? | Required evidence |
| --- | --- | --- | --- | --- |
| `DRAFT` | `FOUNDER_AUTHORIZATION_REQUIRED` | Orchestrator or authoring agent | yes, when contract schema validates | valid task contract; scope; base branch/SHA; validation requirements; allowances |
| `FOUNDER_AUTHORIZATION_REQUIRED` | `AUTHORIZED` | Founder | no | explicit authorize event (GitHub issue comment/label/UI later; v1 may be commit/PR comment with agreed phrase) + authorization timestamp |
| `AUTHORIZED` | `IMPLEMENTING` | Orchestrator | yes | implementer identity assigned; work branch exists or creatable from `base_sha` |
| `IMPLEMENTING` | `VALIDATING` | Orchestrator | yes | `implementation_sha` posted; implementer claims done within scope |
| `IMPLEMENTING` | `FOUNDER_DECISION_REQUIRED` | Implementer/Orchestrator | detect auto / progress no | founder checkpoint encountered; recorded question |
| `IMPLEMENTING` | `BLOCKED` | Orchestrator | yes | missing spec, infra precondition, or authority gap |
| `IMPLEMENTING` | `CRITICAL_FAILURE` | Orchestrator | yes | safety/integrity breach attempt or unrecoverable tool corruption |
| `VALIDATING` | `REVIEWING` | Orchestrator | yes | required local/CI validation green **or** task-declared advisory exceptions recorded without renaming failure to pass; `implementation_sha` immutable for this cycle |
| `VALIDATING` | `REMEDIATION_REQUIRED` | Orchestrator | yes | validation failed and retries remain |
| `VALIDATING` | `BLOCKED` | Orchestrator | yes | validation failed and retry budget exhausted, or required check unavailable |
| `REVIEWING` | `REMEDIATION_REQUIRED` | Reviewer via Orchestrator | yes | findings with severity ≥ task threshold (default: any Critical/Important) |
| `REVIEWING` | `FOUNDER_REVIEW` | Orchestrator | yes | review approved at `reviewed_sha == implementation_sha`; validation still green; closure package assembled; no unresolved blocking findings |
| `REVIEWING` | `FOUNDER_DECISION_REQUIRED` | Reviewer/Orchestrator | yes | material doctrine conflict or checkpoint |
| `REMEDIATION_REQUIRED` | `REMEDIATING` | Orchestrator | yes | remediation round < max; findings attached |
| `REMEDIATING` | `VALIDATING` | Orchestrator | yes | new `implementation_sha`; previous `reviewed_sha` cleared/invalidated |
| `FOUNDER_REVIEW` | `CLOSED` | Founder | no | merge completed **or** explicit docs-only close authorization; closure evidence finalized |
| `FOUNDER_REVIEW` | `REMEDIATION_REQUIRED` | Founder | no | founder rejects with in-scope changes requested |
| `FOUNDER_REVIEW` | `FOUNDER_DECISION_REQUIRED` | Founder | no | founder escalates a decision |
| `FOUNDER_DECISION_REQUIRED` | `AUTHORIZED` / `IMPLEMENTING` / `REMEDIATING` / `PAUSED` / `CANCELLED` | Founder | no | written decision recorded on task |
| `BLOCKED` | `AUTHORIZED` / `IMPLEMENTING` / `PAUSED` / `CANCELLED` | Founder | no | unblock decision + evidence |
| `CRITICAL_FAILURE` | `PAUSED` / `CANCELLED` / (rare) `AUTHORIZED` | Founder | no | incident disposition |
| `*` | `PAUSED` | Founder | no | pause reason |
| `PAUSED` | prior resumable state | Founder | no | resume authorization |
| any non-terminal | `CANCELLED` | Founder | no | cancel reason |

### 4.4 Automatic vs founder-required

**Automatic (orchestrator):**
`DRAFT→FOUNDER_AUTHORIZATION_REQUIRED`, `AUTHORIZED→IMPLEMENTING`,
`IMPLEMENTING→VALIDATING`, `VALIDATING→REVIEWING|REMEDIATION_REQUIRED|BLOCKED`,
`REVIEWING→REMEDIATION_REQUIRED|FOUNDER_REVIEW` (when evidence complete),
`REMEDIATION_REQUIRED→REMEDIATING`, `REMEDIATING→VALIDATING`,
stale-review invalidation, Slack notify on gate states.

**Founder-required:**
authorize, merge/close, decisions, pause/resume/cancel, production mutation,
destructive apply, any authority exception, disposition of `BLOCKED` /
`CRITICAL_FAILURE`.

### 4.5 Loop limits

| Loop | Limit | On exceed |
| --- | --- | --- |
| Validation retries after implement/remediate (same SHA cycle) | 2 automatic re-runs for flaky infra only; **0** for deterministic test failures | `REMEDIATION_REQUIRED` if tests failed with budget; else `BLOCKED` |
| Review ↔ remediation rounds | **5** (matches existing ledger `fix round N/5`) | `FOUNDER_DECISION_REQUIRED` with full finding history — not silent continue |
| Scope-expansion attempts | 0 automatic | `FOUNDER_DECISION_REQUIRED` or `BLOCKED` |
| Stale-review regenerations after head moves | counts as a new review cycle toward the 5 | same exceed behavior |

**Review-intensity policy (from founder process change):**

- **Strict loop (up to 5):** migrations, RLS/permissions, security harnesses, publicly
  reachable endpoints, money/rights paths, CI/governance files.
- **Single-pass default:** ordinary internal code. After one Independent Reviewer pass,
  unresolved Important+ either remediates once or escalates to `FOUNDER_REVIEW` with
  findings visible — orchestrator must not infinite-loop “ordinary” code. Critical always
  blocks closure.

### 4.6 Failure behavior (state-level)

- Ambiguous state / missing evidence → do not advance; remain or `BLOCKED`.
- Head SHA moves after `reviewed_sha` set → invalidate approval; return to `VALIDATING`
  or `REVIEWING` as appropriate; never treat prior approval as valid.
- Required status check fail → not closable.
- Advisory/non-required check fail → record honestly; closable only if task contract
  explicitly lists that check as non-blocking **and** the failure matches a documented
  pre-existing baseline (e.g. known `pnpm audit` on `main`). Still never rename fail→pass.

---

## 5. Machine-readable task contract

### 5.1 Serialization recommendation

**v1 format: YAML file + companion Markdown execution ledger.**

| Artifact | Path | Role |
| --- | --- | --- |
| Task contract | `docs/agentic-engineering/tasks/<task_id>.yaml` | Canonical machine state + authority fields |
| Execution ledger | `docs/superpowers/ledgers/<date>-<slug>.md` (existing convention) | Append-only human reasoning trail |
| Design/plan | `docs/superpowers/specs|plans/...` (existing) | What/how; referenced, not replaced |
| GitHub PR | GitHub | Code review surface, checks, SHA movement |
| GitHub Issue (optional mirror) | GitHub | Discoverability / authorization comment thread |

**Why YAML task files (not Issue-only, not JSON-only, not frontmatter-only):**

- **Machine readable** without HTML scraping
- **Git-auditable** (diffs, blame, PRs) — same trust model as migrations/docs
- **Human readable** enough for founder skim
- **Low complexity** — no new database, no Issue-schema lock-in
- **Fits repo culture** — governance already lives in `docs/`

Markdown+frontmatter is acceptable as an alternative if an implementer strongly prefers one
file, but split YAML + ledger matches “machine fields vs reasoning narrative” cleanly and
avoids frontmatter size/escape pain for audit arrays.

GitHub Issue fields are a **mirror**, not the sole source of truth: Issues are easy to edit
without SHA discipline and are weaker for structured nested evidence.

### 5.2 Required fields

```yaml
# docs/agentic-engineering/tasks/AE-0001.yaml
schema_version: 1
task_id: AE-0001
title: "..."

state: DRAFT  # canonical state enum

# Scope
authorized_scope:
  - "..."
out_of_scope:
  - "..."
source_refs:
  - path: docs/superpowers/specs/...
  - path: docs/superpowers/plans/...
  - path: docs/domain-spec.md
    sections: ["§12"]

# Git pins
base_branch: main
base_sha: "<full sha>"          # exact authorize-time pin
work_branch: "feat/..."
implementation_sha: null        # head under test
reviewed_sha: null              # SHA the reviewer actually inspected
review_status: none             # none|pending|changes_requested|approved|stale
pr_number: null

# Actors (role → durable identity string; vendor-agnostic)
implementer:
  role: implementer
  agent: cursor            # cursor|codex|claude_code|human|other
  identity: "..."          # session/actor label
reviewer:
  role: reviewer
  agent: codex
  identity: "..."
orchestrator:
  agent: github_actions    # or local_runner|human|other
  identity: "..."

# Validation
validation_requirements:
  local_commands:
    - "pnpm typecheck"
    - "pnpm test"
    - "pnpm exec eslint src"
    - "pnpm build"
  required_status_checks:
    - isolation            # required on main today
  observed_status_checks:
    - checks               # observe; may be non-blocking if baseline-exception recorded
  baseline_exceptions: []  # explicit, never silent
acceptance_criteria:
  - id: AC1
    description: "..."
    satisfied: false

# Authority allowances (default deny)
destructive_ops_allowed: false
production_mutation_allowed: false
dependency_addition_allowed: false
ci_workflow_change_allowed: false
merge_authority: founder          # founder only in v1
review_intensity: strict          # strict|single_pass

# Loop counters
remediation_count: 0
max_remediation_rounds: 5
validation_context: null          # after_implement|after_remediate|null

# Findings & gates
unresolved_findings: []           # structured list
founder_gates: []                 # checkpoints hit / pending
scope_violations: []

# Notifications
slack:
  last_notification_at: null
  last_notification_kind: null
  delivery_failures: 0

# Closure
closure_package_path: null        # e.g. docs/agentic-engineering/closures/AE-0001.md
closure_evidence: null

# Timestamps
created_at: "..."
authorized_at: null
updated_at: "..."
closed_at: null

# Audit trail (append-only in practice; store as list)
audit_trail:
  - at: "..."
    from_state: DRAFT
    to_state: FOUNDER_AUTHORIZATION_REQUIRED
    actor: orchestrator:...
    evidence_refs: []
```

### 5.3 Finding object shape

```yaml
- id: F1
  severity: Critical          # Critical|Important|Minor
  status: open                # open|addressed|deferred|wont_fix_founder
  summary: "..."
  evidence: "path/file.ts + reviewed_sha"
  introduced_at_sha: "..."
  resolved_at_sha: null
```

### 5.4 Closure package (human-facing)

Generated Markdown under `docs/agentic-engineering/closures/<task_id>.md` containing:

- task id/title/state
- PR URL + number
- `base_sha`, `implementation_sha`, `reviewed_sha` (must match for closable)
- CI summary for required + observed checks (raw conclusions, not euphemisms)
- unresolved findings
- remediation round count
- destructive/production allowance status (must both be false for default pilot)
- scope violations (must be empty)
- recommended founder action: `merge` / `reject` / `decide X` / `apply production separately`

---

## 6. Authority matrix

Legend:

- **AA** — agent-autonomous
- **AS** — agent-autonomous within authorized slice
- **FD** — founder decision required
- **FE** — founder execution required (decision alone is insufficient)

| Action | Classification | Notes |
| --- | --- | --- |
| Reversible implementation details | AS | Inside authorized scope only |
| Architecture (material) | FD | `AGENTS.md` founder checkpoints |
| Product behavior | FD | Spec gaps → ask; record in domain-spec/same PR |
| UI / copy / branding / visual | FD | Founder checkpoint |
| Schema design in a migration file | AS or FD | AS only if slice explicitly authorized to write migration SQL; still **FE to apply** |
| Apply migrations (local/prod) | FE | Destructive-ops rule; hooks block agents |
| Destructive DB operations | FE | Show exact SQL; explicit approval |
| AWS production changes / spend | FE | Runbooks are docs; founder executes |
| Vercel production env/project changes | FE | |
| Dependency additions | FD (+ usually AS after approve) | Default `dependency_addition_allowed: false` |
| Security-control changes (RLS, harnesses, isolation) | FD + strict review | Never weaken to greenwash |
| CI workflow changes | FD | `ci_workflow_change_allowed` default false; secret-trigger lessons apply |
| PR creation | AS | On work branch for authorized task |
| PR updates (push in scope) | AS | Invalidates prior `reviewed_sha` |
| Review remediation | AS | Within scope + round budget |
| Merge to `main` | FE (or FD with founder clicking merge) | **Not autonomous in v1** |
| Deployment | FE / platform auto | Vercel auto-deploy on `main` is platform behavior; agents must not treat that as licence to merge |
| Production validation | FE | HANDOFF: reviewed ≠ validated |

---

## 7. GitHub control plane

### 7.1 Responsibilities

| Concern | v1 design |
| --- | --- |
| Branch creation | Orchestrator/Implementer creates `work_branch` from `base_sha` (not floating `main`) |
| Task record persistence | YAML in repo on the work branch; authorization may land via founder commit/comment |
| PR creation | One PR per task (or per explicitly authorized task group); link `task_id` in title/body |
| Labels | Suggested: `ae/task`, `ae/state:<STATE>`, `ae/strict-review`, `ae/single-pass`, `ae/founder-gate` |
| Checks/statuses | Observe GitHub Check Runs; required = task `required_status_checks` |
| Review comments | Independent Reviewer writes findings on the PR **and** structured findings in YAML |
| Required reviews | Prefer branch protection + Code Owners; agent “approval” is not a substitute for founder merge authority |
| CI | Existing `ci.yml`; do not special-case fail→pass |
| Commit SHA pinning | `implementation_sha` set from PR head |
| Reviewed SHA pinning | `reviewed_sha` set only by Reviewer/Orchestrator after real diff inspection |
| Stale-review invalidation | If `pr.head.sha != reviewed_sha`, set `review_status: stale`, clear approval, leave `FOUNDER_REVIEW` if already there only after re-review |
| Closure evidence | Closure Markdown + YAML fields + PR link + check run URLs |
| Merge authorization | Founder only |

### 7.2 Reviewed-SHA invariant (non-negotiable)

> Reviewer approves SHA A, implementer pushes SHA B, orchestrator treats the previous review
> as still valid — **forbidden.**

Rules:

1. Approval is valid only while `reviewed_sha == implementation_sha == pr.head.sha`.
2. Any new push sets `review_status: stale` and nullifies closure readiness.
3. Closure package must print all three SHAs; mismatch ⇒ not closable.
4. “Re-approve without diff” is `CRITICAL_FAILURE` / protocol violation if detected.

### 7.3 Base SHA drift

At authorization, pin `base_sha`. If `main` moves materially before merge:

- Orchestrator does **not** auto-rebase/merge.
- Transition to `FOUNDER_DECISION_REQUIRED` or `BLOCKED` with divergence summary when:
  - merge conflicts exist, or
  - changed files on `main` intersect the task touch set, or
  - security/schema files on `main` moved under the task’s paths.
- Clean non-overlapping drift may be reported in the closure package as
  `main_ahead_by: N` without auto-rebasing unless the founder authorizes rebase.

### 7.4 PR trust boundary for future workflows

When Phase B/C add Actions:

- Secret-bearing workflows must follow `migration-drift.yml` lessons:
  - **Do not** trigger privileged secret jobs on `pull_request` from arbitrary heads such
    that the workflow definition from the PR head can exfiltrate secrets.
  - Prefer `pull_request_target` only with extreme care; default v1: orchestration that needs
    secrets runs from `main`/trusted workflow definitions, operating on PR metadata via API.
- Untrusted PR code must not receive production credentials.

---

## 8. ChatGPT role (after orchestration exists)

ChatGPT Project moves **up** the stack:

- product/architecture thinking
- founder decision support
- phase planning for Agentic Engineering and product slices
- exception interpretation when the system surfaces `FOUNDER_DECISION_REQUIRED`
- reviewing closure packages with the founder
- determining the **next** bounded slice

ChatGPT is **not** a required hop between Implementer and Reviewer transitions.
The orchestrator carries findings and SHAs; ChatGPT should not be the clipboard.

---

## 9. Cursor / Codex relationship

### 9.1 Abstract roles

The state model names **Implementer** and **Reviewer** only (plus Founder, Orchestrator,
Validation function). Vendor is a binding on the task record, not on the state machine.

### 9.2 Expected v1 mapping

| Role | Expected v1 binding |
| --- | --- |
| Implementer | Cursor (agent/IDE session) |
| Reviewer | Codex (independent agent session) |
| Orchestrator | GitHub-centric automation + thin router (Phase C+); human-orchestrated bootstrap allowed in Phase A/B |
| Validation/Closure | Deterministic function/script |

### 9.3 Portability rule

Replacing Cursor with Claude Code, or Codex with another reviewer, must require **only**
task field changes (`implementer.agent`, `reviewer.agent`) and runner adapters — not state
renames, not contract schema forks.

Independence requirement remains: reviewer runtime/context must not be the implementer’s
same session with memory of “how to defend the patch.”

---

## 10. Slack exception inbox

### 10.1 Role

Slack is an **exception inbox**, not a progress firehose.

### 10.2 Default notify states

Only:

- `FOUNDER_REVIEW`
- `FOUNDER_DECISION_REQUIRED`
- `BLOCKED`
- `CRITICAL_FAILURE`

No notify on every implement/validate/review tick.

### 10.3 Minimum payloads

Common fields: `task_id`, `title`, `state`, `pr_url`, `work_branch`, deep link to task YAML.

**`FOUNDER_REVIEW` must include:**

- task id + title
- PR number/URL
- `implementation_sha`
- `reviewed_sha`
- CI state (required checks + observed checks, raw)
- required checks list
- unresolved findings (count by severity + top items)
- `production_mutation_allowed` status
- `destructive_ops_allowed` status
- scope violations
- recommended founder action

**`FOUNDER_DECISION_REQUIRED`:** decision question, options if known, blocking evidence,
what is frozen until answered.

**`BLOCKED`:** blocker class, missing precondition, last good SHA, next human action.

**`CRITICAL_FAILURE`:** failure class, what was halted, what must not be done next,
incident pointers.

### 10.4 Notification vs approval actions

**Recommendation: notification-only in v1.**

Why safer:

- Approval buttons create a second, weaker control plane that can drift from GitHub/YAML
- Mobile mis-taps on merge-adjacent actions are unacceptable for Tier 3
- Founder already has GitHub + task YAML as authoritative surfaces
- Slack delivery failures must not create split-brain approvals

v2 may add ack/emoji for “received,” still keeping merge/authorize in GitHub.

If Slack delivery fails: retry modestly, record `slack.delivery_failures`, but **do not**
block `FOUNDER_REVIEW` state itself — the PR/closure package remains the source of truth;
optionally fall back to GitHub mention/@founder comment.

---

## 11. Failure and escalation behavior

| Situation | Behavior |
| --- | --- |
| Implementation fails tests | `VALIDATING` → `REMEDIATION_REQUIRED` (or stay implementing if implementer self-fixes before posting SHA). Deterministic failures do not get infinite flake retries. |
| CI fails required check | Not closable; remediation or `BLOCKED` if environmental |
| CI fails non-required check | Record raw failure; closable only with explicit baseline exception on task |
| Reviewer finds issues | `REMEDIATION_REQUIRED` with structured findings; round++ |
| Review/repair loops exceed 5 | `FOUNDER_DECISION_REQUIRED` with history |
| Branch moves after approval | stale review invariant; re-validate + re-review |
| Scope ambiguous | `FOUNDER_DECISION_REQUIRED` or `BLOCKED`; fail closed |
| Required spec missing | `BLOCKED`; do not invent (`domain-spec.md` / `AGENTS.md`) |
| Founder checkpoint encountered | `FOUNDER_DECISION_REQUIRED`; stop |
| Destructive op appears necessary | halt; `destructive_ops_allowed` remains false unless founder rewrites contract; apply still FE |
| Production access appears necessary | `FOUNDER_DECISION_REQUIRED` / `BLOCKED`; never self-elevate |
| Slack delivery fails | record failure; GitHub fallback comment; state stands |
| GitHub API / orchestrator unavailable | fail closed (no speculative merges); resume later; no silent local-only “closed” |
| Agents disagree materially | `FOUNDER_DECISION_REQUIRED` with both evidence packs; no majority vote of bots |
| Reviewer cannot obtain independent context | `BLOCKED` / `CRITICAL_FAILURE` — cannot approve |
| `main` moves materially after authorize | §7.3 drift policy |
| Attempt to weaken isolation harness / baseline | `CRITICAL_FAILURE` |
| Orchestrator uncertainty | do not advance |

---

## 12. Security model

### 12.1 Least privilege

- Orchestrator tokens: minimum scopes to read PR/checks, comment, label, push only to
  task branches if push is required; **no** production cloud credentials in v1 orchestrator.
- Implementer/reviewer sessions: existing repo denies on `.env` / `secrets/**`
  (`.codex/config.toml`; Claude deny rules). Automation must not bypass these.
- Prefer read-only review tokens where possible.

### 12.2 Secrets

- Never read/print/commit `.env`, `.env.*`, `secrets/`.
- No production Supabase/AWS/Stripe/Trolley secrets in client bundles or chat logs.
- Slack webhook/token: server-side only, repo secret; never echoed into PR bodies.
- GitHub token: least scope; rotate on leak suspicion.

### 12.3 Prompt injection

- Repository content and PR text are untrusted input to agents.
- Orchestrator must treat task YAML authority fields as the policy engine; model prose
  cannot widen `authorized_scope` or flip allowance booleans.
- Reviewer must ignore “APPROVED” claims inside code comments/docs unless evidence matches.

### 12.4 Malicious or risky PR code

- Untrusted PR workflows must not receive privileged secrets (see migration-drift design:
  no secret-bearing `pull_request` head-defined workflow execution).
- Self-modifying orchestration: changes under `docs/agentic-engineering/**` implementation
  paths, `.github/workflows/**`, `.codex/**`, `AGENTS.md`, `CLAUDE.md` require
  `review_intensity: strict` and founder decision before enabling broader autonomy.
- Agents may not approve their own governance-reducing patches.

### 12.5 Protected / governance files

Treat as high-risk touch set:

- `AGENTS.md`, `CLAUDE.md`
- `docs/domain-spec.md`, `docs/HANDOFF.md`
- `.github/workflows/**`, `.github/CODEOWNERS`
- `.codex/**`, `.claude/**`
- `scripts/security/**`
- `supabase/migrations/**`

Default: out of scope for ordinary tasks unless explicitly authorized.

### 12.6 Production credentials

Not available to v1 automation. Production migration apply, AWS runbooks, and spend remain
founder-executed per HANDOFF.

### 12.7 migration-drift as design exemplar

Copy these properties into future AE workflows:

1. Least-privilege credential (`drift_reader`, not account token)
2. Password out-of-band (`PGPASSWORD`), not URL-embedded
3. No PR-head workflow definition executing with secrets
4. Symmetric comparison / fail on empty results
5. Loud failure preferred to silent green

---

## 13. Auditability

| Fact | Canonical home | Notes |
| --- | --- | --- |
| Authorization | task YAML `authorized_at` + audit_trail (+ GitHub comment) | Don’t fork across three truths |
| Implementation commits | git + `implementation_sha` | |
| Review findings | task YAML `unresolved_findings` + PR review threads | Ledger narrates reasoning |
| Remediation rounds | task YAML counters + ledger entries | |
| CI results | GitHub Check Runs; closure package snapshots conclusions at decision time | |
| State transitions | task YAML `audit_trail` | Append-only discipline |
| Founder decisions | task YAML + ledger + (optional) domain-spec update in same PR when product doctrine changes | |
| Merge | GitHub merge commit SHA recorded in closure | |
| Reasoning behind non-obvious fixes | `docs/superpowers/ledgers/...` | Already highest-value context per HANDOFF |

Avoid duplicating canonical SHAs in Slack as authority; Slack may echo them for convenience
only.

---

## 14. v1 scope

### 14.1 Will automate

- task-state routing
- bounded implementation assignment/routing
- deterministic validation observation
- independent review routing
- bounded remediation loops (with caps)
- PR preparation/updates for the task branch
- CI observation
- founder notification (Slack) at exception states
- closure package assembly

### 14.2 Will not automate (confirmed against repo evidence)

| Excluded | Why |
| --- | --- |
| Founder product decisions | `AGENTS.md` checkpoints; domain-spec open decisions |
| Final architecture decisions | founder checkpoint |
| Production migrations | destructive-ops + HANDOFF FE |
| Destructive database operations | hooks + policy |
| AWS production changes / spend | runbooks founder-executed |
| Production spend / backfill fleet | explicit FE |
| Unrestricted deployment authority | Vercel follows `main`; merge is the real gate |
| Autonomous merge to `main` | Tier 3; CODEOWNERS/founder |
| Reinterpreting failed checks as pass | HANDOFF isolation baseline lesson |
| Silent local migration apply as proof for others | HANDOFF: local DB non-authoritative when agents deviate |

### 14.3 Pilot-eligible work shape

Low-risk, docs-or-narrow-code slices with:

- `destructive_ops_allowed: false`
- `production_mutation_allowed: false`
- clear in/out scope
- existing spec/plan references
- no dependency/CI/governance file changes unless the AE system itself is the task
  (chicken/egg: AE implementation tasks are founder-supervised phases, not the first
  unattended pilot)

---

## 15. Implementation phases (after this spec is approved)

Do **not** assume OpenClaw or any dedicated agent platform is required. Prefer repository-
native GitHub + docs + thin scripts first. Phase H evaluates a dedicated orchestrator only
if Phases A–G prove the state model and still lack reliability.

### Phase A — Task contract + state persistence

- **Objective:** Durable YAML schema + validation + example task; state enum frozen.
- **Repo changes:** `docs/agentic-engineering/tasks/`, schema/readme, maybe a pure
  validator script (no Actions required yet).
- **Risk:** low (docs/schema only).
- **Validation:** schema examples validate; invalid transitions rejected by validator.
- **Founder checkpoint:** approve schema field set + authorize/close semantics.

### Phase B — GitHub state / PR integration

- **Objective:** Bind task ↔ branch ↔ PR ↔ SHAs; labels; stale-review detection rules.
- **Repo changes:** docs + optional `gh`-driven scripts; still no secret-heavy Actions
  required.
- **Risk:** medium (API auth, mis-pinning SHAs).
- **Validation:** simulated push-after-approve marks review stale.
- **Founder checkpoint:** confirm merge remains founder-only.

### Phase C — Implementer / Reviewer routing

- **Objective:** Route work packets to Implementer and Independent Reviewer without founder
  clipboard; enforce role separation.
- **Repo changes:** runner adapters; prompts/packets referencing task YAML; ledger write
  conventions.
- **Risk:** medium-high (agent non-compliance, scope creep).
- **Validation:** dry-run on a docs-only task; verify reviewer reads diff at SHA.
- **Founder checkpoint:** approve vendor bindings and independence rules.

### Phase D — Validation / Closure

- **Objective:** Deterministic validation + closure package generation.
- **Repo changes:** closure templates; check-run observation; readiness predicate.
- **Risk:** medium (lying green; ignoring required `isolation`).
- **Validation:** mutate a test so readiness fails; confirm fail-closed.
- **Founder checkpoint:** required vs observed checks list.

### Phase E — Slack notifications

- **Objective:** Exception-inbox notifications only.
- **Repo changes:** secret config docs; notifier; no approval buttons.
- **Risk:** medium (secret handling, noise).
- **Validation:** only four states notify; failure fallback to GitHub comment.
- **Founder checkpoint:** Slack workspace/channel + secret placement.

### Phase F — First bounded pilot

- **Objective:** Unattended coordination on one low-risk authorized task (§16).
- **Repo changes:** minimal; mostly operations.
- **Risk:** process risk > code risk.
- **Validation:** pilot acceptance criteria (§16) all true with evidence pasted.
- **Founder checkpoint:** choose pilot task; authorize; walk away; dispose closure.

### Phase G — Hardening

- **Objective:** Fix protocol gaps found in pilot; tighten stale-review, drift, budgets.
- **Repo changes:** schema/orchestrator fixes; docs lessons in Known Gotchas if durable.
- **Risk:** medium.
- **Validation:** replay pilot failure modes.
- **Founder checkpoint:** whether to allow broader task classes.

### Phase H — Optional dedicated orchestrator evaluation

- **Objective:** Evaluate whether in-repo Actions+scripts are enough or a dedicated
  orchestrator host is warranted.
- **Repo changes:** evaluation note; possibly none.
- **Risk:** low if evaluation-only; high if premature platform adoption.
- **Validation:** written comparison against A–G metrics (founder interrupts/task,
  stale-review incidents, false closes).
- **Founder checkpoint:** adopt/defer platform.

---

## 16. Pilot acceptance criteria

### Pilot shape

Founder authorizes **one low-risk bounded engineering task** (prefer docs/governance-adjacent
or narrowly scoped non-production code already specified). Then the founder does **not**
manually carry messages between ChatGPT, Cursor, Codex, and GitHub.

### Success requires evidence for all of:

1. Task contract created (`docs/agentic-engineering/tasks/<id>.yaml`)
2. Implementation routed automatically (founder did not paste the brief into Cursor as courier)
3. Validation executed (commands/CI observed; raw results recorded)
4. Independent review executed on the real diff at a pinned SHA
5. Remediation routed automatically if needed (or explicitly skipped because review clean)
6. `reviewed_sha` pinned and equal to `implementation_sha` at closure time
7. CI observed (required checks named; failures not euphemized)
8. Founder receives **one** legitimate Slack notification when action is required
   (not a per-step stream)
9. Founder inspects **one closure package** rather than reconstructing state manually

### Explicit pilot non-requirements

- No production migration apply
- No AWS spend
- No autonomous merge (founder merges or declines)

---

## 17. Open questions

Only items repository evidence cannot settle:

1. **Authorization UX for v1:** What exact founder gesture counts as `AUTHORIZED` —
   GitHub Issue comment phrase, label flip, checkbox in YAML committed by founder, or
   PR review “Authorize AE task”? (All are compatible with the state machine; pick one
   before Phase B.)
2. **Orchestrator host for Phases C–E:** Trusted `main`-defined GitHub Actions vs local
   founder machine runner vs later dedicated host. Phase H exists because this is unsettled;
   v1 protocol does not depend on OpenClaw.
3. **Single-pass vs strict classification edge cases:** Who classifies a task that touches
   both ordinary UI and a publicly reachable route — default to `strict` automatically, or
   always founder-set at authorization?
4. **Whether docs-only tasks may `CLOSED` without merging to `main` via PR** if the change
   already landed by another path — default recommendation is still “PR + founder merge,”
   but confirm for pure planning docs on an AE branch.

No open question is raised here about whether production migrations, destructive ops, or
autonomous merges can be agent-owned — repository doctrine already answers **no**.

---

## 18. Mapping to current manual practice (informative)

| Manual today | v1 automation |
| --- | --- |
| ChatGPT brief → founder → Cursor | Founder authorizes task; Orchestrator routes Implementer packet |
| Cursor done → founder → Codex | Orchestrator routes Reviewer packet at `implementation_sha` |
| Codex findings → founder → Cursor | `REMEDIATION_REQUIRED` → Implementer with structured findings |
| Founder babysits CI | Validation/Closure observes checks |
| Founder reconstructs state from chat | Closure package + task YAML + ledger |
| Founder applies prod migrations | Still founder (out of scope) |

Reference pattern already proven in-repo: screener-proxy **spec → plan → ledger** with
SHA-pinned implement/review/fix rounds and independent Cursor vs Codex reviews
(`docs/HANDOFF.md`, `docs/superpowers/ledgers/2026-08-06-screener-proxy.md`).

---

## 19. Document control

- **This file is the v1 coordination spec.** Implementation plans for Phases A–H should land
  under `docs/superpowers/plans/` (or `docs/agentic-engineering/plans/`) only after founder
  approval of this document.
- Amendments that change authority, state names, or SHA invariants require founder approval.
- Do not claim Agentic Engineering is implemented because this file exists.
