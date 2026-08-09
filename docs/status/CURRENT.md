# Current operating status

**Last verified:** 2026-08-09 (local observation on branch `docs/agent-operating-truth-reconciliation`)

This is the **only canonical active-status document**. Historical handoffs, ledgers, and abandoned branches are not authority. Consult them only as evidence when the task requires that history — then re-verify against the repository.

---

## Repository

| Fact | Value | Evidence |
| --- | --- | --- |
| Remote | `Carpenter-Create/globalcontent-dashboard` | GitHub / local remotes |
| Observed `origin/main` SHA | `1a6c89d52c4abc0be908f7c1bf8807069f9548aa` | `git rev-parse origin/main` (2026-08-09) |
| Tip commit | Merge PR #101 — Agentic Engineering Phase B | `git log -1` on `main` |

Pull before trusting SHAs recorded here.

---

## Currently authorized work

**Truth reconciliation of agent operating docs** (this PR scope): correct stale active-state documentation only. No application code, CI, credentials, or production changes.

Broader AGENTS.md / CLAUDE.md compression and context-optimization are **not** authorized in this slice.

---

## Agentic Engineering phase status

| Item | Status | Evidence |
| --- | --- | --- |
| Spec v1 | Accepted on `main` | Merged PR [#99](https://github.com/Carpenter-Create/globalcontent-dashboard/pull/99) (`de4a0ed`) |
| Phase A | Merged; valid on `main` | Merged PR [#100](https://github.com/Carpenter-Create/globalcontent-dashboard/pull/100) (`413a859`) |
| Phase B | Merged; valid on `main` (local/dry-run control plane) | Merged PR [#101](https://github.com/Carpenter-Create/globalcontent-dashboard/pull/101) (`1a6c89d`) |
| Phase C | **Abandoned / not merged** | Experimental work on `feat/agentic-engineering-phase-c` failed independent safety review; repair attempts abandoned. Branch may still exist remotely — **not authoritative**; do not resume without a new founder-authorized design |
| Live control plane | **Not activated** | Real `ae/control` branch does **not** exist |
| Live GitHub writes | **Not activated** | No GitHub App / control-writer credential installed or verified for this system |
| Slack / unattended routing / autonomous remediation / autonomous merge / production agent access | **Not active** | Founder disposition + Phase B docs (dry-run only) |

Architecture and phase notes: `docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md`, `PHASE_A.md`, `PHASE_B.md`.

---

## Active safety / production gates

Binding doctrine remains in `AGENTS.md` / `CLAUDE.md` (and domain truth in `docs/domain-spec.md`):

- Production mutation and destructive operations are **founder-only**.
- Never read, print, or commit `.env`, `.env.*`, or `secrets/`.
- Migrations, RLS/auth changes, and destructive SQL require explicit founder approval of the exact SQL.
- Do not invent open founder decisions from the domain spec.
- Agentic Engineering automation (when later activated under a new design) still cannot soften these gates.

Do **not** treat dated production-migration or CI claims in `docs/HANDOFF.md` as current without fresh verification.

---

## Implementer / reviewer separation

- **Cursor** — primary implementer.
- **Codex** — independent reviewer.
- Only one of Cursor or Codex edits a given working tree at a time.
- Founder authorization remains required for consequential gates and merge to `main`.

---

## Next founder gate

Independent Codex review of this truth-reconciliation documentation PR, then founder merge decision. No Phase C resume, Phase D, or live activation is authorized by this document.

---

## Not authority

- `docs/HANDOFF.md` — historical handoff originally written 2026-08-07 and subsequently updated; preserve as evidence; do not act on its branch/SHA/production/task statements without fresh verification.
- Abandoned or experimental branches (including `feat/agentic-engineering-phase-c`) — not current operating truth.
- Old ledgers/plans/specs under `docs/superpowers/` — reasoning history for their slices; not a substitute for this file.
