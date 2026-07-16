# CLAUDE.md — Project Rules

> Lives in this product's repo root. Loaded every session on top of the global
> ~/.claude/CLAUDE.md (working contract, stack defaults, destructive-ops intent, founder
> checkpoints, verification — all inherited; don't repeat them here). This file holds only
> what's specific to THIS project. Keep it under ~200 lines.

## Project Tier
Tier: ______   (1 = throwaway / 2 = internal / 3 = client-facing, multi-tenant, money or PII)
Heavier rules (full spec, blast-radius review, security) apply at Tier 2–3.

## What This Project Is
(one or two lines: what it is, who it's for)

## Platform
(single app | monorepo — monorepo only if mobile is a committed near-term plan)

## Stack Overrides
(only where this project deviates from the global defaults — otherwise delete this section)

## Coding & Security Standards (project-specific)
(type safety, env-var handling, RLS posture, no secrets in client code, tenant isolation.
If a rule only applies to certain files, move it to .claude/rules/ instead of bloating this file.)

## Destructive-Ops Rule (intentionally duplicated — safety; enforced by the hook)
> IMPORTANT: Never run migrations, drop/alter tables, delete rows, or change RLS/auth config
> without first showing me the exact SQL and getting explicit approval.

## Known Gotchas (living — durable lessons only)
Append lessons worth carrying forward. Consult before starting a task. Gotchas are
project-specific — don't assume another project's pitfalls apply here.

-
