# Global Content Agentic Engineering v1

- **Status:** specification only — not implemented
- **Branch target for this doc:** `feat/agentic-engineering-v1`
- **Base at authoring:** `db0de83dfd7da483ded7233446df7da553c66233`
- **Revision:** post–Codex architecture/governance review (CHANGES REQUIRED → remediated in-spec)
- **Audience:** founder + any engineer/agent implementing the orchestration system
- **Authority:** This document defines *coordination automation*. It does not override
  `AGENTS.md`, `CLAUDE.md`, `docs/domain-spec.md`, or `docs/HANDOFF.md`. Where those
  conflict with convenience, those win.

---

## 0. Repository evidence this design is built on

| Source | What it contributes |
| --- | --- |
| `AGENTS.md` / `CLAUDE.md` | Working contract, founder checkpoints, destructive-ops rule, verification floor, secrets rules |
| `docs/HANDOFF.md` | Production migration gating, “verification that cannot fail,” Cursor/Codex independence practice |
| `docs/domain-spec.md` | Domain truth; open founder decisions must not be invented |
| `.github/workflows/ci.yml` | `checks` + `isolation`; `isolation` is the required status check on `main` |
| `.github/workflows/migration-drift.yml` | Secret-bearing jobs must not run from untrusted PR-head workflow definitions; least privilege; fail closed |
| `.codex/config.toml` + hooks | Secrets deny + destructive-command backstop (seatbelt, not licence) |
| `.github/CODEOWNERS` | Structural ownership (`@acarpcreate`); enables Code Owners merge requirements |
| `docs/superpowers/specs\|plans\|ledgers/*` | Spec → plan → ledger pattern; SHA-pinned implement/review; `fix round N/5` |

**Reuse, do not duplicate live control state:**

- Spec / plan / ledger remain **reasoning and reference** (HANDOFF: ledger carries *why*).
- Agentic Engineering adds a **protected control plane** + **implementation PR**.
- Ledgers, Slack, and closure packages are **derived**, not canonical authority.

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

Coordination cost is the automation target. Product authority is not.

### Objective

Automate coordination around **bounded engineering slices** while preserving human authority
over costly, irreversible, product, architectural, production, and founder-gated decisions.

### Acceptance criterion

> Once the founder authorizes a bounded engineering slice, the founder should be able to
> walk away. No further founder interaction should be required until the system reaches a
> legitimate founder gate, becomes materially blocked, or encounters a critical failure.

### Non-goals for this document

- Implementing orchestration code, workflows, schemas, scripts, or Slack
- Adding dependencies
- Changing application behavior, schema, or migrations
- Invoking production systems

---

## 2. Design principles

1. **Separate implementation plane from control plane.** Mutable authorization, state,
   review, and closure evidence must not live on the implementation PR branch. Recording
   control evidence must never change the SHA under review. No “metadata commits don’t
   count” exception. No ad-hoc content digest of the implementation branch as a substitute
   for exact HEAD equality.
2. **GitHub is the system of record for code motion** (branches, commits, PRs, check runs).
3. **`AGENTS.md`, repository docs, tests, and CI are authoritative governance inputs.**
   Automation routes work; it does not soften doctrine.
4. **Implementer and reviewer are separate roles** with structural isolation (see §9).
5. **Review inspects the actual diff at an exact SHA**, never only an implementer summary.
6. **Founder checkpoints in `AGENTS.md` remain binding.**
7. **Production mutation and destructive execution are always founder-executed in v1.**
   No agent-editable boolean can authorize performing them. A contract may authorize
   *drafting/reviewing* migration SQL or production runbooks when the bounded task allows;
   applying/executing remains founder-only. Writing SQL in a PR ≠ applying it.
8. **Security/isolation controls may not be weakened for automation convenience.**
   Never add `KNOWN_OPEN` entries to greenwash CI. Never convert fail → pass to keep motion.
9. **Fail closed** when authority or state is ambiguous.
10. **Automation must not silently reinterpret repository doctrine.**
11. **A failed automated check is never converted into “pass.”**
12. **Append-only control events** record who/what transitioned state, on which SHAs, with
    evidence references. Rewriteable “audit arrays” are not the authority. Event integrity
    uses protected Git history **and** a per-task hash chain with CAS writes (§4.5).
13. **Trusted validation floor is non-overridable** by task contracts (§8).
14. **Privileged control workflows run only trusted code from protected `main`** (§12).

---

## 3. Roles

### 3.1 Founder

Authority for: authorizing contracts; founder checkpoints; AE phase progression; production
mutation and validation; material architecture/product decisions; merge to `main`;
disposing `BLOCKED` / `CRITICAL_FAILURE` / Important-finding acceptances; resolving material
agent disagreement.

Not required as a message courier between Implementer and Reviewer.

### 3.2 Orchestrator

Owns task-state transitions and routing on the **control plane**.

Does: verify transition evidence; route Implementer/Reviewer; observe CI; evaluate
closure-readiness predicate; assemble derived closure packages; notify at gates; stop at
founder gates.

Does not: reinterpret product requirements; invent missing spec decisions; implement app
code (unless separately acting as Implementer on another declared binding — discouraged);
approve its own governance changes; merge to `main`; apply migrations; mutate production;
execute or import PR-controlled code from a privileged context.

### 3.3 Implementer

Executes the authorized slice on the **implementation branch / PR only**.

May: implement/remediate within authorized scope; open/update the task PR; push
implementation commits; run local checks for its own feedback.

Must not: write control-plane authority state; expand scope without escalation; apply
migrations / destructive DB ops / mutate AWS or Vercel production; mark validation or
review passed; push after claiming a SHA is under review without expecting invalidation.

### 3.4 Independent Reviewer

Reviews the **actual commit/diff** at `reviewed_sha` against the authorized contract,
`AGENTS.md`, referenced specs, security/isolation, test quality, regressions, scope creep,
and correctness.

Must: use a separate session/run identity; fresh context from governing docs + exact diff;
checkout/read surface pinned to `reviewed_sha`; record provider/model/session identity +
`reviewed_sha`; emit structured findings; refuse summary-only review.

Must not: push to the implementation branch; share the implementer’s session/context;
apply production changes; waive Critical findings.

### 3.5 Validation / Closure (deterministic function, not an agent)

**Recommendation unchanged:** Validation / Closure is a deterministic orchestration
function in v1.

It observes check runs / pinned validation evidence, evaluates the closure-readiness
predicate (§7), emits a **derived** closure package on the control plane, and advances to
`FOUNDER_REVIEW` only when the predicate is true. It does not narrate confidence over
missing evidence.

---

## 4. Protected control-plane design (selected)

### 4.1 Options evaluated

| Option | Strengths | Weaknesses for v1 |
| --- | --- | --- |
| A. Trusted GitHub Issue + comments only | Native numeric actor IDs; low setup | Comment/body edits; weak immutable blob store; easy to fork “truth” across labels vs body |
| B. Protected control branch only | Git-auditable blobs + events | Git author ≠ verified GitHub actor ID; authorization UX awkward |
| C. Check-run metadata only | Excellent for validation evidence | Poor fit for contracts, dispositions, append-only narrative of authority |
| D. **Combination (selected)** | Actor-ID auth via Issue comment *created* events; immutable contract + append-only events on protected branch; check runs for validation; PR for code | Slightly more moving parts than A alone — still no new database |

### 4.2 Selected design: Issue trigger + protected `ae/control` + checks + implementation PR

**Planes:**

| Plane | What lives there | Mutability |
| --- | --- | --- |
| **Implementation PR branch** | Application/docs code under review only | Mutable by Implementer; HEAD is `implementation` input |
| **Protected branch `ae/control`** | Frozen authorized contract blobs; append-only control events; derived closure snapshots | Writable only by founder and the dedicated privileged orchestrator identity under §4.5 integrity rules; never by Implementer/Reviewer credentials |
| **GitHub Issue (`ae/task`)** | Authorization UX; human thread; optional derived labels | Issue body is **non-canonical**. Authorization uses `issue_comment` **created** events only |
| **GitHub Check Runs** | Validation evidence for exact SHA | Platform-canonical for CI/validation |
| **PR review threads** | Human/agent review discussion | Referenced by control events via review/thread IDs; not sole authority |
| **Specs / plans / ledgers** | Design intent + reasoning narrative | Not live task state |
| **Slack** | Derived notifications | Never authority |
| **Closure package** | Derived readiness summary | Written to control plane (Issue comment and/or `ae/control` object); **not** committed to the implementation branch before merge |

**Rejected:** YAML (or any mutable control record) on the implementation branch as canonical
state — it self-invalidates `reviewed_sha == head` when recording approval.

### 4.3 Object layout on `ae/control` (conceptual; not implemented yet)

```
ae/control
  proposed/<task_id>/v<version>.yaml     # pre-auth staging only; NOT authority; replaceable until authorize
  contracts/<task_id>/v<version>.yaml    # created once at authorize; immutable forever for that version
  events/<task_id>/<utc>-<seq>-<type>.json  # append-only; never rewrite/rename/delete
  closures/<task_id>/<head_sha>.md       # derived non-authority mirrors (may be refreshed)
```

**Current state is never a mutable authority file.** State = deterministic fold of:

1. immutable authorized contract blob(s) under `contracts/`
2. valid append-only event chain under `events/`
3. GitHub platform facts (PR head, check runs, review IDs)

Labels, Issue body, Slack, and closure Markdown remain derived mirrors only.

### 4.4 Control Issue

One Issue per task (`label: ae/task`, title includes `task_id`). Used for:

- posting draft contract text for founder skim (non-canonical)
- founder `AE-AUTHORIZE` comment (§5)
- optional human discussion
- derived label mirrors of state (informational only)

### 4.5 Control-ledger integrity model (required before Phase A)

Ordinary branch protection and the phrase “append-only” are **not** sufficient by
themselves. A writer that can commit to `ae/control` could otherwise delete, replace, or
reorder history. v1 therefore requires **layered** enforcement: GitHub history protections
+ workflow-enforced path invariants + per-task event hash chain + serialized CAS writes.

#### 4.5.1 Branch history protections (GitHub rulesets)

`ae/control` MUST be configured so that, at minimum:

- force pushes are blocked;
- branch deletion is blocked;
- direct updates are restricted to the founder identity and the dedicated privileged
  orchestrator identity only;
- Implementer and Reviewer credentials cannot push to `ae/control` and cannot bypass
  those protections (separate tokens; no admin override for agents).

These protections preserve Git history integrity against casual rewrite. They do **not**
by themselves make individual files append-only inside a new forward commit. File-level
append-only is enforced by §4.5.2–§4.5.5 in trusted-main orchestration code.

#### 4.5.2 Append-only object invariant

Once any of these paths exists on `ae/control` at any accepted tip:

- `contracts/<task_id>/v<version>.yaml`
- `events/<task_id>/<event-file>.json`

a later control-plane transition **must not** modify, rename, or delete that path.

New transitions may only **add** new event objects (and, at authorize time, create the
corresponding `contracts/...` blob if absent). Authorized contract blobs are immutable
forever for that `(task_id, contract_version)`.

`proposed/` staging objects are outside this invariant and are never authority. Closing
a contract version means writing `contracts/...` once; it does not rewrite `proposed/`.

#### 4.5.3 Trusted integrity check before every control write

Before the privileged orchestrator creates any new control commit, trusted-main code must:

1. Fetch the current `ae/control` tip SHA (`expected_tip`).
2. Compare the existing protected object set/history against the previously accepted
   control tip / parent commit.
3. Verify that no existing `contracts/**` or `events/**` path has been modified, deleted,
   renamed, or replaced between the previously accepted tip and `expected_tip` (and that
   the commit being prepared would not do so either).
4. Verify per-task event-chain integrity (§4.5.4).
5. If any integrity check fails:
   - perform **no write**;
   - record operational failure out-of-band if possible (Issue comment / Slack) without
     mutating the ledger;
   - treat the task/control plane as `CRITICAL_FAILURE`;
   - notify the founder;
   - require founder disposition under §4.5.7.

This verification runs only from trusted-main orchestration code — never from
PR-controlled code.

#### 4.5.4 Event hash chain

Every control event object includes a verifiable chain. Conceptual shape:

```json
{
  "schema_version": 1,
  "task_id": "AE-0001",
  "sequence": 12,
  "event_type": "review_completed",
  "occurred_at": "2026-08-08T14:00:00.000Z",
  "actor": {
    "kind": "reviewer",
    "provider": "codex",
    "session_or_run_id": "...",
    "github_actor_id": null
  },
  "active_contract_version": 1,
  "active_contract_digest": "sha256:...",
  "prev_event_digest": "sha256:...",
  "payload": {},
  "event_digest": "sha256:..."
}
```

**Digest formulation (deterministic):**

1. Build the canonical event object including all fields except `event_digest`.
2. Serialize with a fixed canonical JSON form defined at implementation time
   (sorted object keys, UTF-8, no insignificant whitespace variance, LF only).
3. `event_digest = "sha256:" + hex(SHA-256(canonical_bytes))`.
4. Persist the object including `event_digest`.

**Chain rules for each `task_id`:**

- Sequence numbers are contiguous integers starting at `1`.
- Event `sequence == 1` sets
  `prev_event_digest = "sha256:genesis:ae-control:<task_id>"`
  (documented genesis string; not the digest of a prior file).
- Each later event’s `prev_event_digest` MUST equal the prior accepted event’s
  `event_digest`.
- Fold is valid only if sequences are contiguous, every `prev_event_digest` matches,
  every `event_digest` recomputes from canonical bytes, and no earlier event object has
  disappeared or changed under `events/<task_id>/`.

The hash chain is **not** a substitute for protected Git history. Use both.

#### 4.5.5 Contract digest linkage

The first authorization event for a contract version (`event_type: authorize`, usually
`sequence == 1` or the first event after a re-authorize on a new version) MUST bind in its
payload / event fields:

- `task_id`
- `contract_version`
- exact `contract_digest`
- `founder_actor_id` (numeric)
- `base_sha`
- Issue number + authorizing `comment_id`

Every subsequent event for that task MUST carry `active_contract_version` and
`active_contract_digest` matching the currently authorized contract. A new authorize event
for `contract_version + 1` is the only way to change the active digest. Silent migration
to another contract is forbidden and fails integrity.

#### 4.5.6 Serialized writers and optimistic CAS

All privileged control-plane writes share **one global concurrency domain**:
`ae-control` (GitHub Actions concurrency group or equivalent single-flight lock).

Per-task locks alone are insufficient: tasks share one branch tip. Global serialization
prevents two runs from reading the same old tip and appending divergent next commits.

**Optimistic compare-and-swap on the branch tip:**

1. Reader/writer notes `expected_tip = current ae/control SHA`.
2. After integrity checks, construct the next commit whose sole parent is `expected_tip`,
   adding only allowed new paths (new event file; and at authorize, new
   `contracts/<task_id>/vN.yaml` if creating that version).
3. Update the `ae/control` ref to the new commit **only if** it still points at
   `expected_tip` (`force: false` / non-fast-forward rejected).
4. If the tip moved: **do not force**. Re-read, revalidate chain and append-only invariant,
   then retry once under policy or stop with fail-closed behavior.
5. No force-push. No history rewrite. No automatic rebase of `ae/control`.

Allowed path deltas for an orchestrator-produced commit (enforced in trusted workflow code,
not by a nonexistent GitHub “path-scoped write” token permission):

- add `events/<task_id>/<new-file>.json`
- add `contracts/<task_id>/v<version>.yaml` only when absent (authorize)
- optionally refresh derived `closures/**` and non-authority `proposed/**` per policy

Any other delta (including touching an existing protected path) → no write →
`CRITICAL_FAILURE` path (§4.5.7).

#### 4.5.7 Founder recovery path (integrity violation)

If `ae/control` integrity is violated (missing/changed protected objects, broken hash
chain, unauthorized tip rewrite, CAS abuse attempt, etc.):

1. Halt unattended orchestration for affected tasks (fail closed).
2. Classify operational state as `CRITICAL_FAILURE`.
3. Preserve evidence (tip SHAs, failing check outputs, actor identities, timestamps).
4. Notify founder (Slack gate + Issue).
5. Founder reviews Git history / audit evidence.
6. Recovery occurs **only** through a founder-approved procedure documented separately.
   The orchestrator must **not** auto-repair, force-push, delete events, or rewrite
   history.

Destructive recovery implementation is out of scope for this specification.

#### 4.5.8 Enforcement realism (do not over-claim GitHub)

Distinguish three layers:

| Layer | What it actually provides |
| --- | --- |
| GitHub branch/rulesets | Who may update the ref; block force-push; block deletion; required status optional |
| Token permissions | Repo-level `contents` read/write only — **not** native path-limited write ACLs. Do not claim path-scoped token permissions GitHub does not offer. |
| Trusted workflow validation | Protected-`main` code validates allowed path deltas, append-only invariant, hash chain, contract digest linkage, and CAS tip updates |

Least privilege for the orchestrator token therefore means: dedicated identity; write
access only to this repository (or the minimum repos needed); **no** `main` merge rights;
**no** production cloud credentials; workflow code refuses unsafe deltas. Path safety is
a property of the writer program + rulesets, not a phantom token scope.

---

## 5. Founder authorization mechanism (exact)

### 5.1 Mechanism selected

**GitHub Issue comment created-event authorization**, verified by a privileged control
workflow defined only on protected `main`, then snapshotted onto `ae/control`.

Agents cannot spoof this by editing repository files: they cannot forge another user’s
GitHub comment, and the workflow ignores comment edits.

### 5.2 Authorize comment schema

Founder posts a **new** Issue comment (not an edit) whose body is exactly parseable as:

```text
AE-AUTHORIZE
task_id: AE-0001
contract_version: 1
contract_digest: sha256:<64 lowercase hex>
base_sha: <40 lowercase hex>
```

Optional trailing notes are forbidden in v1 (keep the payload strict).

### 5.3 Verification steps (privileged workflow)

On `issue_comment` with `action == created` only:

1. Parse payload; reject malformed comments (no state change).
2. Verify `github.event.comment.user.id` equals the configured founder numeric ID
   (`FOUNDER_GITHUB_ACTOR_ID` repository variable — immutable numeric actor ID, **not**
   login/display name).
3. Load the proposed contract bytes for `(task_id, contract_version)` from untrusted
   staging (`proposed/<task_id>/vN.yaml` on `ae/control`, or equivalent Issue-attached
   bytes treated as data). Recompute `sha256` of the exact bytes to be frozen.
4. Require digest match; require `base_sha` exists on the repository and equals the
   contract’s `base_sha` field.
5. Under §4.5 integrity + CAS rules, create one control commit that:
   - adds `contracts/<task_id>/vN.yaml` with those exact bytes (**create-only**; fail if
     the path already exists with different bytes);
   - appends an `authorize` event whose fields bind `task_id`, `contract_version`,
     `contract_digest`, `founder_actor_id`, `base_sha`, `issue_number`, `comment_id`,
     `authorized_at` (comment `created_at`), plus hash-chain fields
     (`sequence`, `prev_event_digest`, `event_digest`, `active_contract_*`).
6. Transition folded state → `AUTHORIZED`.

**Comment edits (`action == edited`) never authorize and never amend an authorize event.**
Changing authority-bearing fields requires a new `contract_version`, new digest, and a new
`AE-AUTHORIZE` comment.

### 5.4 Pre-auth staging

Before authorization, an agent or human may stage bytes at
`proposed/<task_id>/vN.yaml` (or provide them as Issue data). Staging is **not**
authority and may be replaced until authorize. The privileged authorize write is what
creates the immutable `contracts/<task_id>/vN.yaml` blob. Implementation PRs must not
carry control authority files.

---

## 6. Immutable authorization contract

### 6.1 Contract document

The authorized contract is the frozen YAML blob at
`ae/control/contracts/<task_id>/v<version>.yaml` whose digest was bound by the authorize
event.

### 6.2 Fields immutable after authorization

Changing any of these requires `contract_version + 1`, new digest, and renewed founder
`AE-AUTHORIZE`:

| Field | Why immutable |
| --- | --- |
| `authorized_scope` | Prevents silent scope widen |
| `out_of_scope` | Prevents silent reclassification |
| `source_refs` | Pins governing design inputs |
| `base_branch` / `base_sha` | Pins authorize-time starting point |
| `work_branch` policy / naming constraints | Branch policy |
| `implementer` / `reviewer` **role bindings** (agent class + separation requirements) | Role integrity |
| `role_separation` (must be enforced; no self-review flag) | Independence |
| `validation_additions` (extra commands/checks beyond the floor) | Cannot remove floor; additions are pinned |
| `baseline_exceptions` (fingerprint-bound only) | Prevents broad waivers |
| Draft allowances: `may_draft_migration_sql`, `may_draft_production_runbook`, `dependency_addition_allowed`, `ci_workflow_change_allowed` | Authority-bearing |
| `review_intensity` (`strict` \| `single_pass`) | Loop policy |
| `max_remediation_rounds` | Loop cap |
| `acceptance_criteria` (ids + descriptions) | Done-means |

### 6.3 Fields that are *not* in the contract (live on event log / platform)

These change over the task lifetime via **append-only events**, never by rewriting the
authorized contract:

- `state`
- `pr_number`
- `implementation_sha`, `validated_sha`, `reviewed_sha`
- `review_status`
- remediation counters
- findings + dispositions
- closure-ready flag
- Slack delivery bookkeeping

### 6.4 No execution-permission booleans

The contract **must not** contain `production_mutation_allowed` or
`destructive_ops_allowed` (or equivalents) that gate *execution*.

In v1:

- **Destructive DB execution** and **production mutation** are always founder-executed.
- Contract may set `may_draft_migration_sql` / `may_draft_production_runbook` to allow
  agents to *write* those artifacts inside scope for review.
- Orchestrator must treat any attempt to execute apply/push/spend as
  `CRITICAL_FAILURE` / `BLOCKED`, regardless of drafted docs.

### 6.5 Example contract shape (illustrative)

```yaml
schema_version: 1
task_id: AE-0001
contract_version: 1
title: "..."

authorized_scope:
  - "..."
out_of_scope:
  - "production migration apply"
  - "AWS spend"
source_refs:
  - path: docs/superpowers/specs/example.md

base_branch: main
base_sha: "..."   # full SHA
work_branch: "feat/..."

role_separation: required   # v1: always required; field exists to pin the requirement
implementer:
  agent: cursor             # cursor|codex|claude_code|human|other
reviewer:
  agent: codex
# session identities are bound later in events when runs start — not forged in-contract

validation_additions:
  commands: []              # added to floor; cannot remove floor
  status_checks: []         # added to required floor checks
baseline_exceptions: []     # each must include exact fingerprint; founder-authorized only

may_draft_migration_sql: false
may_draft_production_runbook: false
dependency_addition_allowed: false
ci_workflow_change_allowed: false

review_intensity: strict    # strict|single_pass
max_remediation_rounds: 5

acceptance_criteria:
  - id: AC1
    description: "..."
```

Digest input = canonical UTF-8 bytes of this file as frozen (implementations must define
canonicalization: LF endings, stable key order as committed file bytes — **digest the
exact frozen file bytes**, do not re-serialize).

---

## 7. SHA model and closure-readiness predicate

### 7.1 SHA fields

| Name | Meaning | Set by |
| --- | --- | --- |
| `implementation_sha` | PR head the Implementer declared ready for validation/review | control event after implementer declaration; must equal current PR head at use |
| `validated_sha` | Exact SHA for which required validation evidence succeeded | Validation function |
| `reviewed_sha` | Exact SHA the Independent Reviewer inspected and judged | Reviewer completion event |
| `pr.head.sha` | Current GitHub PR head | Platform |

**Closure readiness requires exact equality of all four.**

Required CI/check evidence must belong to that same SHA (`validated_sha`).

### 7.2 Atomic closure-readiness predicate

Evaluate `closure_ready(task)` as a pure function over control events + GitHub API facts:

```
closure_ready :=
  PR exists AND PR state == open
  AND contract_digest/version match the authorized contract bound by authorize event
  AND pr.head.sha == implementation_sha
  AND pr.head.sha == validated_sha
  AND pr.head.sha == reviewed_sha
  AND review_status == approved (for that reviewed_sha)
  AND every required floor check + contract validation_additions
        has a successful check run on pr.head.sha
  AND no required check on that SHA is pending/queued/in_progress
  AND no unresolved Critical findings
  AND no unresolved Important findings without durable founder accept disposition
  AND no open scope_violations
  AND no event indicating unauthorized production/destructive execution attempt
  AND reviewer independence evidence present for reviewed_sha
        (distinct session/run id from implementer; non-pushing reviewer credential used)
  AND acceptance_criteria all satisfied or explicitly founder-disposed where allowed
```

**When to evaluate:**

1. Before transitioning into `FOUNDER_REVIEW`
2. On every PR `synchronize` / head-change event
3. Immediately before founder merge/closure is accepted by the control plane

**On PR head change:** automatically append `invalidate_closure` / `stale_review` events;
clear closure-ready; if state was `FOUNDER_REVIEW`, transition to `VALIDATING` (or
`IMPLEMENTING` if declaration withdrawn). Prior approvals do not survive.

**`FOUNDER_REVIEW` means technically closure-ready** — the predicate is true. It is not a
dumping ground for unresolved blocking defects.

### 7.3 Stale-review invariant

> Reviewer approves SHA A; implementer pushes SHA B; prior approval remains valid —
> **forbidden.**

Also forbidden: recording approval/control evidence by committing to the implementation
branch (would move HEAD).

---

## 8. Trusted validation floor

### 8.1 Floor (non-overridable)

From `AGENTS.md` verification discipline, the **command floor** is:

```text
pnpm typecheck
pnpm test
pnpm exec eslint src
pnpm build
```

From protected-branch / CI governance, the **required status-check floor** includes at
least:

```text
isolation
```

(`isolation` is the required status check on `main` per `ci.yml` / HANDOFF.)

**Tasks may add** commands or checks via `validation_additions`.
**Tasks may not remove or weaken** the floor.

### 8.2 Current CI coverage gap (documented, not waived)

As of this writing, `.github/workflows/ci.yml` `checks` runs typecheck + test (+ audit +
advisory full `pnpm lint`), and does **not** run `pnpm exec eslint src` or `pnpm build`.
HANDOFF also notes build-time env gaps. Phase D must emit check runs covering the full
command floor on the PR SHA (unprivileged PR validation workflow) so closure evidence is
platform-native. Until that exists, unattended closure must not pretend the floor is
satisfied by partial CI.

### 8.3 Baseline exceptions

- Allowed only inside the founder-authorized contract (`baseline_exceptions`).
- Each exception must bind an **exact failure fingerprint** (check name + failing step
  identity + stable error signature / advisory IDs), not broad text like “audit currently
  fails.”
- Exceptions may apply only to **non-floor** observed checks (e.g. known pre-existing
  `pnpm audit` high findings on `main` if that check is observed but not part of the
  floor). They must never waive `isolation` or an AGENTS.md floor command.
- Failed checks are still recorded as failed; exception means “does not block closure,”
  not “passed.”

### 8.4 Validation evidence record

Each validation evidence item (control event or check-run reference) must identify:

- SHA
- command or check name
- result (`success` / `failure` / …)
- check-run ID where applicable
- timestamp
- artifact/log reference (URL or digest)

Implementer-local terminal output is **not** sufficient for `validated_sha`.

---

## 9. Reviewer independence (v1)

### 9.1 Rules

1. **No self-review exception** in v1 — remove founder override that allowed the same agent
   identity to implement and review the same task.
2. Separate reviewer **session/run identity** from the implementer’s.
3. Fresh context: governing docs + exact diff at `reviewed_sha` only.
4. Checkout/read surface pinned to `reviewed_sha`.
5. Reviewer credentials **cannot push** the implementation branch (read-only token or
   branch rules denying reviewer actor pushes).
6. Record `provider`, `model`, `session_or_run_id`, and `reviewed_sha` on the review event.
7. Same model *family* is acceptable; same implementation *session* is not.

### 9.2 Expected v1 vendor mapping (portable)

| Role | Expected binding |
| --- | --- |
| Implementer | Cursor |
| Reviewer | Codex |
| Orchestrator | Privileged control workflow on trusted `main` (+ thin routers) |
| Validation/Closure | Deterministic function |

Vendor changes = runner adapter + role binding fields; state model unchanged.

---

## 10. Task state machine

### 10.1 States

| State | Meaning |
| --- | --- |
| `DRAFT` | Contract being authored; not actionable |
| `FOUNDER_AUTHORIZATION_REQUIRED` | Staged contract awaiting `AE-AUTHORIZE` |
| `AUTHORIZED` | Authorize event recorded; may route implementation |
| `IMPLEMENTING` | Implementer working on implementation branch |
| `VALIDATING` | Deterministic validation for declared `implementation_sha` |
| `REVIEWING` | Independent reviewer on pinned SHA |
| `REMEDIATION_REQUIRED` | In-scope changes required |
| `REMEDIATING` | Implementer addressing findings |
| `FOUNDER_REVIEW` | `closure_ready == true`; founder merge/close action needed |
| `FOUNDER_DECISION_REQUIRED` | Checkpoint, ambiguity, or unresolved Important after allowed rounds |
| `BLOCKED` | Cannot proceed |
| `CRITICAL_FAILURE` | Safety/integrity stop |
| `PAUSED` | Founder pause |
| `CLOSED` | Terminal success (merge recorded) |
| `CANCELLED` | Terminal abandonment |

### 10.2 Terminal states

`CLOSED`, `CANCELLED`.

### 10.3 Selected transitions (authority-relevant)

| From | To | Owner | Auto? | Evidence |
| --- | --- | --- | --- | --- |
| `DRAFT` | `FOUNDER_AUTHORIZATION_REQUIRED` | Orchestrator | yes | staged contract schema-valid on control plane |
| `FOUNDER_AUTHORIZATION_REQUIRED` | `AUTHORIZED` | Founder via §5 | no | verified `AE-AUTHORIZE` + snapshot event |
| `AUTHORIZED` | `IMPLEMENTING` | Orchestrator | yes | implementer run bound; branch from `base_sha` |
| `IMPLEMENTING` | `VALIDATING` | Orchestrator | yes | `implementation_sha == pr.head.sha` declared |
| `VALIDATING` | `REVIEWING` | Orchestrator | yes | `validated_sha == implementation_sha`; floor evidence present |
| `VALIDATING` | `REMEDIATION_REQUIRED` | Orchestrator | yes | validation failed; budget remains |
| `REVIEWING` | `REMEDIATION_REQUIRED` | Orchestrator | yes | open Critical/Important; rounds remain |
| `REVIEWING` | `FOUNDER_DECISION_REQUIRED` | Orchestrator | yes | rounds exhausted with open Important; or checkpoint/conflict. Open Critical may also surface here for founder visibility, but Critical remains non-waivable for `closure_ready` |
| `REVIEWING` | `FOUNDER_REVIEW` | Orchestrator | yes | `closure_ready` predicate true |
| `REMEDIATING` | `VALIDATING` | Orchestrator | yes | new head; prior validated/reviewed SHAs invalidated |
| `FOUNDER_REVIEW` | `CLOSED` | Founder | no | founder merge; control event records merge SHA |
| head change while `FOUNDER_REVIEW` | `VALIDATING` | Orchestrator | yes | auto retract closure-ready |
| `*` | `PAUSED` / `CANCELLED` | Founder | no | founder disposition event |

### 10.4 Loop limits and single-pass policy

| Loop | Limit | On exceed |
| --- | --- | --- |
| Infra-flake validation re-poll | 2 | then `BLOCKED` if still unavailable |
| Deterministic test failures | 0 auto “pass” | `REMEDIATION_REQUIRED` |
| Review ↔ remediation | `max_remediation_rounds` (default 5; pinned in contract) | `FOUNDER_DECISION_REQUIRED` |
| Scope expansion | 0 | `FOUNDER_DECISION_REQUIRED` / `BLOCKED` |

**Review intensity:**

- **`strict`:** up to `max_remediation_rounds` for DB/public/security/money/governance touches.
- **`single_pass`:** ordinary internal code — after the permitted remediation round(s), any
  **unresolved Important** → `FOUNDER_DECISION_REQUIRED` (**not** `FOUNDER_REVIEW`).
- **Critical** findings are **non-waivable** for closure in v1. They never become
  `closure_ready`.

**If founder explicitly accepts/defer-disposes an Important finding:**

1. Append durable `finding_disposition` event (founder actor ID, finding id, disposition,
   timestamp).
2. Re-run validation/review semantics on the **exact current head** as required by the
   predicate (disposition does not skip SHA equality or floor checks).
3. Only then may `closure_ready` become true → `FOUNDER_REVIEW`.

**Classification rule for intensity:** founder sets `review_intensity` at authorization.
If the touch set intersects high-risk paths (migrations, RLS, security harnesses, public
routes, money/rights, workflows/governance), the orchestrator must **upgrade to `strict`**
(never downgrade). Ambiguous touch sets → `strict` or `FOUNDER_DECISION_REQUIRED`.

---

## 11. Authority matrix

Legend: **AA** agent-autonomous · **AS** within authorized slice · **FD** founder decision ·
**FE** founder execution

| Action | Class | Notes |
| --- | --- | --- |
| Reversible implementation details | AS | Scope-bound |
| Material architecture / product behavior / UI-copy-brand | FD | Checkpoints |
| Draft migration SQL / runbook | AS | Only if contract draft flags true |
| Apply migrations / destructive DB / AWS prod / spend / Vercel prod | FE | Always; no enabling boolean |
| Dependency / CI workflow changes | FD | Pinned flags; strict review |
| Security-control changes | FD + strict | Never greenwash |
| PR create/update on implementation branch | AS | Invalidates pins on push |
| Review remediation | AS | Scope + rounds |
| Control-plane event append (orchestrator) | Orchestrator | Privileged workflow only |
| Merge to `main` | FE | Founder-only; token enforcement required |
| Production validation | FE | Reviewed ≠ validated (HANDOFF) |

---

## 12. Workflow trust boundary (binding)

### 12.1 Unprivileged PR validation

- May execute PR code (build/test against the PR head).
- **No** production secrets.
- **No** privileged repository write token (`contents: read` or less; no control-branch
  write; no merge).
- Posts check runs used as validation evidence.

### 12.2 Privileged control workflow

- Workflow **code/definition comes only from protected trusted `main`** (same class of
  constraint as `migration-drift.yml` refusing secret jobs on PR-head-defined workflows).
- Treats PR bodies, Issue bodies, contract drafts, and agent output as **untrusted data**.
- **Never** checks out-and-executes or imports PR-controlled code/scripts.
- Schema-validates all inputs.
- Verifies founder-authorized `contract_digest` / version before honoring scope.
- Enforces §4.5 before every control write (append-only path delta check, hash chain,
  global serialized CAS tip update).
- Least-privilege GitHub permissions in the realistic sense (§4.5.8): dedicated
  orchestrator identity with repository content write sufficient to update `ae/control`
  and to comment/label Issues; **no** merge to `main`; **no** production cloud
  credentials in v1. Path allowlisting is enforced by trusted workflow code, not by a
  nonexistent path-scoped token ACL.
- Governance/workflow changes that expand autonomous authority activate only after
  founder review and merge to `main`.

### 12.3 Token classes (mandatory)

| Token | Capabilities | Forbidden |
| --- | --- | --- |
| Implementer | Push implementation branch; open PR | Merge `main`; push `ae/control`; prod creds |
| Reviewer | Read repo; comment on PR | Push implementation branch; merge; push `ae/control`; prod |
| Privileged orchestrator | Push forward-only CAS updates to `ae/control` after §4.5 checks; comment/label Issues; read checks | Merge `main`; force-push; prod cloud secrets; execute PR code; rewrite protected paths |
| Founder | Merge `main`; authorize; production execution outside agents; integrity recovery procedure | — |

---

## 13. Canonical evidence model

One authority per fact class:

| Fact class | Canonical authority |
| --- | --- |
| Implementation content | Git commits / PR head |
| Authorization, state transitions, founder dispositions, actor identity | Append-only hash-chained events on `ae/control` under §4.5 (+ Issue comment IDs referenced by those events) |
| Authorized contract bytes | Frozen create-once blob on `ae/control` bound by digest in authorize event |
| Validation evidence | GitHub check runs on the exact SHA |
| Review evidence | Control `review_completed` event referencing PR review/thread IDs + reviewer run identity |
| Specs/plans/ledgers | Reasoning / reference only |
| Closure package | Derived output on control plane |
| Slack | Derived notification only |

**Conflict rule:** if a ledger, Issue body, Slack message, or closure Markdown disagrees
with control events + check runs + PR head, the latter win. Derived surfaces are repaired
from canonical data, not the reverse.

---

## 14. Slack exception inbox

Notification-only in v1 (no approval buttons).

Notify only: `FOUNDER_REVIEW`, `FOUNDER_DECISION_REQUIRED`, `BLOCKED`, `CRITICAL_FAILURE`.

**`FOUNDER_REVIEW` payload minimum:** task id/title; PR URL; `implementation_sha`;
`validated_sha`; `reviewed_sha`; `pr.head.sha`; contract version/digest; CI/floor state;
unresolved findings; draft-allowance flags (not execution permissions); scope violations;
recommended founder action (`merge` / `reject`).

Delivery failure: record control event; GitHub Issue fallback mention; do not invent a
second approval channel.

---

## 15. Failure and escalation (summary)

| Situation | Behavior |
| --- | --- |
| Floor/required check fails | not `closure_ready`; remediate or `BLOCKED` |
| Reviewer findings Critical/Important | remediate or escalate per §10.4 |
| Head moves after pins | auto invalidate; leave `FOUNDER_REVIEW` |
| Scope ambiguous / missing spec | `BLOCKED` / `FOUNDER_DECISION_REQUIRED`; do not invent |
| Founder checkpoint | `FOUNDER_DECISION_REQUIRED` |
| Destructive/production execution appears necessary | halt; founder executes outside agent loop |
| Agents disagree materially | `FOUNDER_DECISION_REQUIRED` with both evidence packs |
| Reviewer lacks independent context | cannot approve; `BLOCKED` / `CRITICAL_FAILURE` |
| Privileged workflow uncertainty | fail closed |
| Attempt to weaken isolation harness | `CRITICAL_FAILURE` |
| `ae/control` integrity failure (path rewrite, broken chain, CAS/history abuse) | no write; `CRITICAL_FAILURE`; founder recovery only (§4.5.7) |
| `main` drift vs `base_sha` | report; conflicts or intersecting high-risk paths → founder decision; no silent rebase |

---

## 16. Security model (additional)

- Least privilege per §12.3.
- Never read/print/commit `.env` / `secrets/`.
- Prompt injection: PR/Issue/contract prose cannot widen authorized digests; only
  authorize events + frozen blobs define authority.
- Protected touch set (migrations, RLS, harnesses, workflows, `AGENTS.md`, etc.) defaults
  out of scope unless explicitly in authorized contract; forces `strict`.
- migration-drift exemplar properties apply to AE privileged automation: least privilege,
  no PR-head secret execution, fail loud on empty/unknown.

---

## 17. Mandatory enforcement prerequisites

**Unattended execution (Phase F pilot and beyond) must not start until these exist:**

1. **Branch protection / rulesets on `main`:** required PR; founder-only merge path;
   required status check `isolation` (and floor check runs once added).
2. **Protected / non-forceable `ae/control`:** block force-push; block deletion; restrict
   direct updates to founder + dedicated privileged orchestrator identity; Implementer and
   Reviewer credentials cannot write it or bypass protections.
3. **Append-only path invariant verifier** in trusted-main orchestration (§4.5.2–§4.5.3).
4. **Event-chain verifier** (contiguous sequence, prev digest, recomputed event digests)
   (§4.5.4).
5. **Serialized writer / concurrency domain** `ae-control` (global) (§4.5.6).
6. **Optimistic branch-tip compare-and-swap** with `force: false`; retry/stop on tip move
   (§4.5.6).
7. **Founder-only recovery** from integrity failure; no orchestrator auto-rewrite (§4.5.7).
8. **Founder-only merge authority** enforced by GitHub (Code Owners + rules), not prose.
9. **Agent tokens cannot merge to `main`** (and cannot bypass rulesets).
10. **`FOUNDER_GITHUB_ACTOR_ID` configured** for authorize verification.
11. **Stale-review / head-change invalidation** implemented against the predicate.
12. **Validation floor enforcement** in the readiness predicate (not waivable by task
    contract).
13. **Reviewer role isolation:** separate credentials; reviewer push denied on
    implementation branches.
14. **Privileged vs unprivileged workflow split** merged to `main` before use.

Until then, AE may be documented and dry-run under direct founder supervision, but must
not claim unattended operation.

---

## 18. v1 scope

### Will automate

Task-state routing; bounded implementation assignment; deterministic validation
observation; independent review routing; bounded remediation loops; PR preparation on the
implementation branch; CI observation; founder Slack notification at exception states;
derived closure package assembly on the control plane.

### Will not automate

Founder product/architecture decisions; production migrations; destructive DB execution;
AWS production changes/spend; unrestricted deployment authority; autonomous merge to
`main`; fail→pass conversions; agent self-review.

### Pilot-eligible shape

Low-risk bounded slice; no production/destructive execution; clear scope; existing
spec/plan refs; contract draft flags for migrations/runbooks false unless the slice is
explicitly about drafting those docs.

---

## 19. Implementation phases (after this spec is approved)

No assumption that OpenClaw is required.

| Phase | Objective | Repo changes | Risk | Validation | Founder checkpoint |
| --- | --- | --- | --- | --- | --- |
| A | Control-plane contract/event schema + authorize grammar + **ledger integrity model** (§4.5) frozen in-spec | docs/schema only; no unattended runners; do not create `ae/control` yet | low | digest/chain examples; CAS/invariant semantics review | approve integrity model + authorize mechanism |
| B | `ae/control` rulesets + Issue binding + SHA pin events + integrity verifier wiring | ruleset docs; trusted-main verifier (still no prod) | med | simulate rewrite/delete/race → no write + CRITICAL_FAILURE; CAS rejects tip move | confirm merge remains founder-only |
| C | Implementer/Reviewer routing with isolation | runner adapters | med-high | reviewer cannot push; distinct session recorded | vendor bindings |
| D | Validation floor check runs + readiness predicate | unprivileged CI additions as needed; predicate | med | mutate head/checks → not ready | floor list |
| E | Slack notification-only | secret docs + notifier | med | only four states | channel + secrets |
| F | First bounded pilot | ops | process | §20 criteria | authorize + walk away |
| G | Hardening | protocol fixes | med | replay failures | broaden task classes? |
| H | Optional dedicated orchestrator evaluation | note | low | compare interrupt rate | adopt/defer |

Phase A in this revision is **control-plane schema/design freeze**, not “YAML on the
feature branch.”

---

## 20. Pilot acceptance criteria

Founder authorizes one low-risk bounded task and does not manually courier messages between
ChatGPT, Cursor, Codex, and GitHub.

Success evidence:

1. Contract frozen on `ae/control` with authorize event (actor ID + digest + base SHA + hash chain) and §4.5 integrity prerequisites live
2. Implementation routed without founder clipboard
3. `validated_sha` set from floor check runs on exact SHA
4. Independent review on exact diff; review event recorded
5. Remediation auto-routed if needed
6. `pr.head.sha == implementation_sha == validated_sha == reviewed_sha`
7. CI/floor observed without euphemism
8. One legitimate Slack notify at a gate state
9. One derived closure package for founder inspection
10. Enforcement prerequisites (§17) satisfied for the pilot environment

Non-requirements: production apply, AWS spend, autonomous merge.

---

## 21. ChatGPT role

After orchestration exists: product/architecture thinking; founder decision support; phase
planning; exception interpretation; closure review with founder; choosing the next bounded
slice. **Not** a required hop on every implement/review transition.

---

## 22. Mapping to current manual practice (informative)

| Manual today | v1 |
| --- | --- |
| Founder pastes briefs between tools | Orchestrator routes from control events |
| Cursor ↔ Codex via founder | Separate roles; findings on control plane + PR threads |
| Founder babysits CI | Readiness predicate observes check runs |
| Founder reconstructs state | Derived closure package |
| Founder applies prod migrations | Still founder (FE) |

---

## 23. Open questions

Only items still unsettled after this revision:

1. **Orchestrator host for Phases C–E at runtime:** trusted `main` GitHub Actions vs a
   local founder-supervised runner for early dry-runs. Protocol is Actions-shaped; Phase H
   still evaluates a dedicated host if needed. Not OpenClaw-required.
2. **Numeric founder actor ID value** to configure as `FOUNDER_GITHUB_ACTOR_ID` (operational
   secret/config, not an architecture choice).
3. **Whether docs-only AE meta-work must always close via PR to `main`** — recommendation
   remains yes for anything that changes protected governance; pure Issue+control-branch
   contract experiments may stay on `ae/control` without an application PR.

Resolved by this revision (no longer open): founder authorization UX; control-plane
persistence choice; self-review exception; production/destructive enabling booleans;
single-pass → `FOUNDER_REVIEW` ambiguity; validation floor overridability.

---

## 24. Codex review disposition

| Finding | Disposition |
| --- | --- |
| Critical — control state on implementation branch self-invalidates SHA | **Resolved** — §2.1, §4; control plane separated |
| Critical — founder auth / scope spoofable via agent YAML | **Resolved** — §5 identity-bound authorize; §6 immutability |
| Critical — review/CI freshness not atomic | **Resolved** — §7 `validated_sha` + readiness predicate + head-change retract |
| Critical — privileged workflow boundary under-specified | **Resolved** — §12 binding split |
| Important — single-pass vs blocking threshold | **Resolved** — unresolved Important → `FOUNDER_DECISION_REQUIRED` (§10.4) |
| Important — validation floor waivable | **Resolved** — §8 |
| Important — reviewer independence not structural | **Resolved** — §9; self-review exception removed |
| Important — duplicated canonical evidence / rewriteable audit | **Resolved** — §13 append-only events |
| Minor — §2.7 destructive wording inverted | **Resolved** — §2.7 / §6.4 |
| Focused re-review — `ae/control` append-only not enforceable | **Resolved** — §4.5 integrity model (history protections + path invariant + pre-write checks + hash chain + CAS + founder recovery); token path-ACL overclaim corrected (§4.5.8) |

**Findings not accepted as written:** none of the Critical/Important items were rejected.
One refinement relative to a possible over-reading: baseline exceptions remain expressible
for **non-floor** observed checks with exact fingerprints (needed because `main`’s
non-required `checks` audit can be red without making AE pretend audit passed). Floor
checks remain non-waivable — aligned with HANDOFF’s “never baseline-away isolation.”

Previously resolved findings listed in §24 above were **not** weakened by the §4.5
integrity addition.

---

## 25. Document control

- Spec-only. Implementation plans land only after founder approval of this document.
- Amendments to authority, SHA invariants, authorize mechanism, or control-plane choice
  require founder approval.
- Do not claim Agentic Engineering is implemented because this file exists.
