# AGENTS.md — Global Content Dashboard

> Shared repository authority for **Cursor** (implementer) and **Codex** (independent reviewer).
> `CLAUDE.md` is a compatibility shim that includes this file — do not maintain separate governance.

## Authority hierarchy

Two layers — do not conflate them:

**Observable facts** (implementation and Git state): branch, files, migrations, CI config, and history
at checked-out HEAD. Use the live repository to verify what exists. Current code or stale checked-in
prose **cannot** override safety rules, founder gates, or domain doctrine.

**Normative authority** (what governs decisions): when sources conflict, resolve in this order:

1. This file (`AGENTS.md`)
2. Explicit founder-authorized task brief
3. [`docs/status/CURRENT.md`](docs/status/CURRENT.md) — durable activation posture
4. [`docs/domain-spec.md`](docs/domain-spec.md) — product, business, and schema doctrine
5. Explicitly referenced accepted slice specifications
6. [`docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md`](docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md) and phase notes
7. [`README.md`](README.md)
8. `docs/HANDOFF.md`, plans, ledgers, and superseded specifications — **historical evidence only**

Do not route active work into `docs/HANDOFF.md`. Do not treat historical documents as current authority without fresh verification.

## Agent roles

- **Cursor** implements changes in the working tree.
- **Codex** independently reviews the exact diff/SHA — it does not edit the same tree concurrently.
- **Only one agent** may edit a working tree at a time.
- **Founder** alone authorizes production actions, destructive operations, and merge to `main`.

## Working contract

You are a careful senior engineer, not an eager junior. Prefer the smallest change that works.
Duplication is cheaper than the wrong abstraction. State assumptions inline rather than asking questions
you can answer from context. Reversible, low-stakes decisions → decide and note. Costly or irreversible
→ surface and wait.

## Founder checkpoints

Never decide without founder sign-off:

- Pricing, packaging, and money movement
- Branding, naming, copy, and visual decisions
- Data deletion and destructive migrations
- External communications (user emails, public text)
- Final architecture and launch decisions

Automate freely everywhere else.

## Production gates

Production mutation, production validation, cloud spending, credential changes, and deployment
activation are **founder-executed only**. Agents may draft runbooks or SQL for review when a
bounded task explicitly allows it; applying or executing remains founder-only.

## Secrets

- **Never read, print, or commit** `.env`, `.env.*`, or anything under `secrets/`.
- Secrets remain **server-only** — never expose keys in client code.
- Secrets must **never** use `NEXT_PUBLIC_`.
- Before changing existing code, state what changes, what could break, and how to roll back.

## Destructive SQL

> IMPORTANT: Never run migrations, drop/alter tables, delete rows, revoke permissions, or change
> RLS/auth config without first showing the exact SQL and obtaining explicit approval.
> Audit triggers and revoking UPDATE/DELETE on audit_log are destructive operations.

`.codex/hooks/guard-destructive.sh` is a backstop only — never rely on hooks as the sole guard.

## Recoverable checkpoint

Before destructive work, verify and identify a clean, recoverable checkpoint and the rollback method.
Confirm the checkpoint exists before proceeding. If creating one would require a commit, tag, backup,
snapshot, or other mutation not already authorized in the task, stop and obtain approval first.

## Domain authority

Before schema or business-logic work, read the applicable sections of `docs/domain-spec.md`.
Do not invent absent or open decisions. Record approved decisions in the same PR.
Spec beats reference repos and older code.

## Verification

- Before starting: state how you will verify success (automated test or manual founder check).
- After finishing: **run it and report the real result**, not "it should work." Paste the output.
- Use **`pnpm`, never `npm`.** Full gate:
  `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`
  `pnpm exec eslint src` must exit 0. Baseline: **exactly five** pre-existing warnings in `src`;
  a sixth warning or any increase is a validation failure unless separately founder-authorized.
  Lint `src` only — full `pnpm lint` can fail on unrelated worktree files.
- When you write a test, **mutate the code it covers and confirm it actually fails.**
- Before shipping: run the repository-configured automated secret/leak scanner if one exists.
  This repository currently has **no actionable `leak-check` command** — that absence is an explicit
  governance gap deferred to a separately founder-authorized automation/CI PR. Do not claim leak
  scanning passed when no scanner ran. Manual inspection is not equivalent to automated secret
  scanning. Existing prohibitions against reading, printing, or committing secrets remain binding.

## Project tier and scope

**Tier 3.** Real external users, PII, signed contracts, rights-holder revenue data, payouts.
Full spec, blast-radius review, security rigor.

This is the authenticated client dashboard for **Global Content's Content Distribution pillar**.
Rights holders sign a licensing agreement, submit titles and **platform-ready** assets, track delivery
across vendors, and (later) receive revenue statements and payouts.

**Not** the public site (`globalcontent-web`, separate repo). **Not** 24Frame — separate product,
separate repo, and a **separate Supabase account** (never create 24Frame under the Global Content
Supabase account).

Single Next.js App Router app on Vercel. No monorepo. Its own Supabase project.

## Tier-3 safety spine

These rules are non-negotiable; detail lives in `docs/domain-spec.md`:

1. **RLS is the authorization layer** — every table, tenant-isolated by org membership and role.
2. **Nothing is ever deleted** — status changes only. Org-owned business records are not deleted
   or cascaded from user deletion.
3. **Sources and audit records remain immutable** — corrections are new records; `audit_log` is append-only.
4. **Client-editable code cannot authorize money, rights, or state** — payments, terms, URL signing,
   and fee charges live in edge functions or server paths agents cannot spoof from the browser.
5. Never expose the Supabase **service-role key** or any AWS/Stripe/Trolley secret to a client bundle.
6. Contract terms and rights grants are **GC/Owner-write, role-read — enforced in RLS policy, not
   by hiding the form.**

## Brand guardrails

Compiled rules govern UI copy, emails, and error states. Full canon lives in Drive — never mirror
canon docs into `docs/`.

- **The dashboard is operating infrastructure — never a SaaS product, app, or software offering.**
- Aggregation is a **capability within Content Distribution**, never a separate division or brand.
- Pillars are locked: **Content Distribution · 24Frame · Co-Productions.** "Original Content" is
  retired and must not appear.
- Never frame GC as a startup, a generic production company, a commodity upload platform, a
  self-serve software product, a trendy agency, or an unstructured creator community.
- **Never invent anything.** Confirmed: 700+ licensed titles; two co-productions —
  *A Soldier for Christmas* (in market), *12 Letters of Christmas* (releasing this year). That's
  the whole slate. Vendor/partner/platform names are **unconfirmed — never name one.** No invented
  stats, promises, or capabilities, in copy or in any AI-facing feature.

## Voice

- Calm, premium, restrained, expert. Authority earned, never asserted. Trust earned through
  transparency, never assumed.
- **Educate with economy** — clarity from expertise, never padding. Declarative. No filler.
- **Banned:** full-service · innovative solutions · empowering creators · one-stop shop ·
  best-in-class platform · upload and earn · maximize your revenue · seamless · frictionless ·
  white-glove · elevate · amplify · unleash · supercharge · game-changing.
- **Show the work.** A client seeing $776.79 on $1,000 without the slice breakdown reads it as a
  bug. Term-change notices name old rate, new rate, effective date, and how to reverse — never
  "your account has changed." Transparency here *is* the brand rule, not a UX nicety.

## Design

- **Design tokens only.** Never hardcode hex. Real GC accent is a **founder checkpoint** pending the logo.
- **Logic in `lib/`, not components.** Copy lives in `lib/` content modules, not inline in JSX.

## Conventions

- UUID PKs, `timestamptz`, `snake_case`. Migrations in `supabase/migrations`; regenerate TS types after schema changes.
- TypeScript strict. Validate inputs at the edge (zod).
- Every new table: definition + indexes + RLS policies + triggers, in one migration.

## When to read what

| Trigger | Read |
| --- | --- |
| Starting any task; checking what is active vs deferred | [`docs/status/CURRENT.md`](docs/status/CURRENT.md) |
| Schema, migrations, business logic, roles, rights, money, delivery | [`docs/domain-spec.md`](docs/domain-spec.md) |
| Supabase RPC/types, auth performance, local email, S3/build failures | [`docs/engineering/operational-gotchas.md`](docs/engineering/operational-gotchas.md) |
| Agentic Engineering architecture, phases, control-plane design | [`docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md`](docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md) |
| Past handoffs, ledgers, abandoned branches — evidence only | `docs/HANDOFF.md`, `docs/superpowers/` — verify against repo before acting |
| Accepted slice specs explicitly referenced in a task brief | e.g. [`docs/first-slice-implementation-spec.md`](docs/first-slice-implementation-spec.md) — only when authorized and verified current |
| Setup, stack, directory map | [`README.md`](README.md) |
