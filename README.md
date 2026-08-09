# Global Content Dashboard

Authenticated client dashboard for **Global Content's Content Distribution** pillar. Rights holders sign a licensing agreement, submit titles and platform-ready assets, track delivery across vendors, and (later) receive revenue statements and payouts.

This is **not** the public site (`globalcontent-web`) and **not** 24Frame (separate product, separate Supabase account).

**Tier 3** — real users, PII, contracts, rights-holder revenue data. Treat accordingly.

## Stack

- Next.js App Router (Vercel)
- Supabase (Postgres + Auth + RLS)
- AWS S3 / CloudFront / MediaConvert
- Stripe (money in) · Trolley (money out, later)
- TypeScript strict · Vitest · pnpm

## Run locally

Use **`pnpm`, never `npm`.**

Running local Supabase requires a separately installed Supabase CLI; `package.json` does not supply it.

```bash
pnpm install
cp .env.example .env.local   # fill values locally; never commit secrets
pnpm exec supabase start     # local Supabase when needed
pnpm dev
```

Do not print or commit `.env`, `.env.*`, or anything under `secrets/`.

## Directory map

| Path | Role |
| --- | --- |
| `src/app/` | Next.js App Router routes |
| `src/components/` | UI |
| `src/lib/` | Domain logic, data access, shared modules |
| `supabase/` | Migrations, config, pgTAP |
| `docs/` | Specs, plans, ledgers, status |
| `scripts/` | Repo tooling (including Agentic Engineering dry-run) |
| `AGENTS.md` | Shared Cursor/Codex governance |
| `CLAUDE.md` | Claude Code compatibility shim (`@AGENTS.md`) |

## Source of truth

| Need | Read |
| --- | --- |
| **Current operating posture** | [`docs/status/CURRENT.md`](docs/status/CURRENT.md) |
| Domain model / schema intent | [`docs/domain-spec.md`](docs/domain-spec.md) |
| Agent governance & safety | [`AGENTS.md`](AGENTS.md) |
| Operational gotchas (conditional) | [`docs/engineering/operational-gotchas.md`](docs/engineering/operational-gotchas.md) |
| Agentic Engineering architecture | [`docs/agentic-engineering/`](docs/agentic-engineering/) |
| Historical handoff (evidence only) | [`docs/HANDOFF.md`](docs/HANDOFF.md) |

## Validation

```bash
pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build
```

Baseline: 0 eslint errors in `src` (known pre-existing warnings may exist). Lint `src` only — full `pnpm lint` can fail on unrelated worktree files.

Agentic Engineering local dry-run: `pnpm ae:dry-run`.
