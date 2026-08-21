# AGENTS.md — Global Content Dashboard

> Shared repository authority for **Global Content Dev**, **Cursor**, and **Codex** (independent reviewer).
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

Do not route active work into `docs/HANDOFF.md`.

## Agent roles

- **Founder** decides and authorizes scope. Founder alone authorizes merge to `main`, production, destructive operations, deployment, credential changes, and applying SQL.
- **Global Content Dev** may analyze and plan without implementation permission. After explicit founder authorization, it may implement bounded docs, tests, application code, refactors, branches, commits, and PRs. Planning is not implementation permission. Implementation is not merge permission. Possession of legal or commercial inputs is not permission to alter them.
- **Cursor** is an available implementer, not mandatory. Founder or Global Content Dev may route authorized work there.
- **Codex** independently reviews the exact resulting diff, commit, or PR regardless of implementer. Implementation and independent review must not collapse. Codex does not edit the same tree concurrently.
- **Only one agent** may edit a working tree at a time.

## Code Review Rules

Codex Cloud Automatic reviews comment on every pull request. No `@codex review` mention is required.

Comment only on P0 and P1 findings. Do not leave nits, style notes, or optional suggestions.

Merge policy:
- Codex comments do not block glance merges (isolation green, no reserved gate).
- Codex findings block reserved-gate PRs only: SQL/RLS, auth, financial, legal, secrets, infrastructure.

This file governs Carpenter-Create/globalcontent-dashboard only. Do not apply these rules to Watershed, E8, personal, or any other repository. Do not request org-wide GitHub access.

Codex reviews the exact diff. It does not implement on the same tree. Cursor Bugbot may also comment; Codex is the independent review gate. Do not recommend CodeRabbit or a third AI reviewer.

Reserved gates stay founder-only even if Codex is silent.

## Working contract

Smallest change that works. Duplication over the wrong abstraction. State assumptions inline.
Reversible, low-stakes decisions: decide and note. Costly or irreversible: surface and wait.

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
- Before shipping: run **`pnpm governance`** on governance-sensitive paths or before handoff.
  Local run: policy checks, governance tests, scanner canary, and a **staged-only** Gitleaks scan
  (**v8.30.0**; **v8.30.1** is disqualified). Set `GITLEAKS_BIN` if needed — never download.
  CI adds a checksum-verified install and a sanitized **full-history** scan. Do not claim a leak
  scan passed if no scanner ran. Manual inspection is not automated secret scanning.

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

- Active vs deferred: [`docs/status/CURRENT.md`](docs/status/CURRENT.md)
- Schema, roles, rights, money: [`docs/domain-spec.md`](docs/domain-spec.md)
- RPC, auth, email, S3, builds: [`docs/engineering/operational-gotchas.md`](docs/engineering/operational-gotchas.md)
- Agentic Engineering: [`docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md`](docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md)
- Handoffs — historical evidence only: `docs/HANDOFF.md`, `docs/superpowers/`
- Authorized current slice specs only, e.g. [`docs/first-slice-implementation-spec.md`](docs/first-slice-implementation-spec.md)
- Setup: [`README.md`](README.md)
