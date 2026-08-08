# Agentic Engineering — Phase A notes

Companion to `AGENTIC_ENGINEERING_V1.md`. Does not replace the architecture.

## Location

Pure TypeScript modules: `src/lib/agentic-engineering/`.

No network, no GitHub writes, no `ae/control` branch, no workflows.

## Contract digest

**Exact frozen UTF-8 file bytes** after canonical-form enforcement (spec §6.5).

1. Validate structured contract with `taskContractSchema`.
2. Emit canonical YAML via `formatCanonicalContractYaml` (LF, fixed key order,
   trailing newline; **all string scalars double-quoted JSON-style**).
3. `digestContractFileBytes` asserts the input equals that canonical form, then
   `sha256:` + hex(SHA-256(utf8 bytes)).

Booleans are only bare `true` / `false`. Integers are lexical decimal. Bare or
single-quoted string forms are rejected. Digest binds exact frozen UTF-8 bytes.

## Event digest / JSON-safe domain

`event_digest = sha256:` + hex(SHA-256(canonical JSON of event **without** `event_digest`)).

Payloads and digest inputs are constrained to a JSON-safe domain (string, finite
number, boolean, null, arrays, plain string-keyed objects). `undefined`, `NaN`,
`Infinity`, `Date`, class instances, and forbidden keys (`__proto__`,
`constructor`, `prototype`) are rejected. Canonicalization uses null-prototype
containers and never silently drops unsupported fields.

## Authority event payloads

`controlEventSchema` is a discriminated union on `event_type` with **strict**
payloads per type. Missing `outcome` / `status` never defaults to success /
approved. Unknown fields on authority-bearing events are rejected.

## Genesis

Sequence `1` must set:

`prev_event_digest = sha256:genesis:ae-control:<task_id>`

This is a documented sentinel, not a content hash.

## Event chain

`verifyEventChain` schema-validates before digest/chain acceptance, then checks
contiguous sequences, genesis/prev digests, recomputed `event_digest`, constant
`task_id`, and active contract continuity (only `authorize` may change
`active_contract_*`).

## Protected path grammar

Strict repository-relative forms only:

- `contracts/<task_id>/v<positive-integer>.yaml`
- `events/<task_id>/<6-digit-seq>-<event_type>.json`
- `closures/<task_id>/<40-hex-sha>.md`
- `proposed/<task_id>/v<positive-integer>.yaml`

Unknown classes and path-bypass forms (`/`, `\`, `..`, empty segments) fail closed.

## State fold

`foldTaskState` derives current task state from a valid event chain. Mutable
`current_state` files are not authority.

- `validation_completed` / `review_completed` require explicit outcomes.
- Approved `review_completed` remains in `REVIEWING`.
- Only `founder_review_ready` (exact SHA + contract + evidence pins) enters
  `FOUNDER_REVIEW`.

## Closure readiness

`evaluateClosureReadiness` takes contract-derived **expectations**
(`authorizedContract` version/digest, required checks, acceptance IDs) plus
session/push attestation, and **observed** evidence including folded
`activeContractVersion` / `activeContractDigest` (never inferred from
expectations).

- Observed active contract must exactly equal authorized contract identity.
- `VALIDATION_FLOOR_CHECK_NAMES` members are non-omittable and must each appear
  exactly once in expected required checks; contracts may only add.
- Duplicate expected or observed check / acceptance evidence fails closed.
- Important waivers require `controlEvents` that pass `verifyEventChain` inside
  the predicate; `finding_disposition` events are derived only from that
  verified chain. Matching uses task ID, finding ID, configured founder actor
  ID `CONFIGURED_FOUNDER_GITHUB_ACTOR_ID` (40549435), and active contract pins.
  Standalone disposition objects are not accepted. Critical is non-waivable.
- Reviewer independence is derived (same session / push capability fail closed).
