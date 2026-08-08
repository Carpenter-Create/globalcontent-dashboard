# Agentic Engineering — Phase A notes

Companion to `AGENTIC_ENGINEERING_V1.md`. Does not replace the architecture.

## Location

Pure TypeScript modules: `src/lib/agentic-engineering/`.

No network, no GitHub writes, no `ae/control` branch, no workflows.

## Contract digest

**Exact frozen UTF-8 file bytes** after canonical-form enforcement (spec §6.5).

1. Validate structured contract with `taskContractSchema`.
2. Emit canonical YAML via `formatCanonicalContractYaml` (LF, fixed key order, trailing newline).
3. `digestContractFileBytes` asserts the input equals that canonical form, then
   `sha256:` + hex(SHA-256(utf8 bytes)).

Do not digest a re-serialized AST from another YAML library.

## Event digest

`event_digest = sha256:` + hex(SHA-256(canonical JSON of event **without** `event_digest`)).

Canonical JSON: sorted object keys at every level, arrays keep supplied order, compact
UTF-8, no insignificant whitespace (`canonicalJsonString`).

## Genesis

Sequence `1` must set:

`prev_event_digest = sha256:genesis:ae-control:<task_id>`

This is a documented sentinel, not a content hash.

## Event chain

`verifyEventChain` checks contiguous sequences, genesis/prev digests, recomputed
`event_digest`, constant `task_id`, and active contract continuity (only `authorize`
may change `active_contract_*`).

## Protected deltas

`verifyProtectedObjectDelta(prior, next)` enforces create-once on `contracts/**` and
`events/**`. `closures/**` and `proposed/**` are non-authority.

## State fold

`foldTaskState` derives current task state from a valid event chain. Mutable
`current_state` files are not authority.

## Closure readiness

`evaluateClosureReadiness` is a pure predicate over a structured snapshot. It encodes
`pr.head.sha == implementation_sha == validated_sha == reviewed_sha` and the other
§7.2 gates. No GitHub API calls.
