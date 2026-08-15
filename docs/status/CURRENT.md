# Current operating posture

This is the **only canonical active-status document**. Historical handoffs, ledgers, and abandoned branches are not authority. Consult them only as evidence when a task requires that history — then re-verify against the live repository.

---

## Agentic Engineering

| Item | Posture |
| --- | --- |
| Architecture spec v1 | **Accepted** on `main` |
| Phase A | **Merged** — dry-run/local foundations (control-plane schema and library primitives) |
| Phase B | **Merged** — dry-run/local foundations (supervised local control ledger) |
| Phase C | **Abandoned and unmerged** — do not resume without a new founder-authorized design |
| Live `ae/control` branch | **Not activated** |
| Live GitHub control writes | **Not activated** |
| Autonomous routing, remediation, merge, or production agent access | **Not active** |

Architecture and phase detail: [`docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md`](../agentic-engineering/AGENTIC_ENGINEERING_V1.md), `PHASE_A.md`, `PHASE_B.md`.

---

## Agent roles and merge authority

- **Founder** authorizes scope. Founder alone authorizes merge to `main`, production actions, and destructive operations.
- **Global Content Dev** may implement bounded repository work after explicit founder authorization. Planning is not implementation permission. Implementation is not merge permission.
- **Cursor** is an available implementer, not mandatory.
- **Codex** independently reviews the exact diff/SHA regardless of implementer.
- Only one agent edits a given working tree at a time.

---

## Binding safety gates

Full doctrine: [`AGENTS.md`](../../AGENTS.md). Domain truth: [`docs/domain-spec.md`](../domain-spec.md).

- Production mutation, production validation, cloud spending, credential changes, and deployment activation are **founder-executed only**.
- Never read, print, or commit `.env`, `.env.*`, or `secrets/`.
- Migrations, RLS/auth changes, and destructive SQL require explicit founder approval of the exact SQL.
- Do not invent open founder decisions from the domain spec.
- Agentic Engineering automation — when later activated under a new design — cannot soften these gates.

---

## Production posture

| Item | Status |
| --- | --- |
| Production database release | **Complete** |
| Migration state | **Fully applied; no pending migrations** |
| Terminal catalog and RLS state | **Verified** |
| Release verification suites | **Passed** |
| Duplicate invariant | **Clean** |
| Safe unauthenticated smoke checks | **Passed** |
| Authenticated operator/client smoke checks | **Deferred** |
| Fresh pre-deployment logical backup | **Retained outside the repository** |
| Managed/PITR posture | **Not independently confirmed** |
| Earlier failed apply attempt | **No production mutation** |
| Wrapper compatibility repair | **Merged before the successful apply** |
| Successful apply | **No post-apply repair, retry, or restore** |

---

## Not authority

- [`docs/HANDOFF.md`](../HANDOFF.md) — historical handoff; preserve as evidence; do not act on its branch, SHA, production, or task statements without fresh verification.
- Abandoned or experimental branches — not current operating truth.
- Old ledgers/plans/specs under `docs/superpowers/` — reasoning history for their slices; not a substitute for this file.
- [`docs/first-slice-implementation-spec.md`](../first-slice-implementation-spec.md) — superseded slice spec; historical reference only unless a founder-authorized task explicitly re-verifies it.
