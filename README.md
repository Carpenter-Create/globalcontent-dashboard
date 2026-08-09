# Global Content Dashboard

Authenticated client dashboard for **Global Content’s Content Distribution** pillar. Rights holders sign a licensing agreement, submit titles and platform-ready assets, track delivery across vendors, and (later) receive revenue statements and payouts.

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
| `AGENTS.md` / `CLAUDE.md` | Agent / project governance |

## Source of truth

| Need | Read |
| --- | --- |
| **Current operating status** | [`docs/status/CURRENT.md`](docs/status/CURRENT.md) |
| Domain model / schema intent | `docs/domain-spec.md` |
| Working contract & safety | `AGENTS.md` (Codex) · `CLAUDE.md` (Claude Code) |
| Historical handoff (not active authority) | `docs/HANDOFF.md` |
| Agentic Engineering architecture | `docs/agentic-engineering/` |

## Validation

```bash
pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build
```

Baseline: 0 eslint errors in `src` (known pre-existing warnings may exist). Lint `src` only — full `pnpm lint` can fail on unrelated worktree files.

Agentic Engineering local dry-run (Phase B): `pnpm ae:dry-run`.

## Agent workflow (summary)

1. Read [`docs/status/CURRENT.md`](docs/status/CURRENT.md) for active state.
2. Follow `AGENTS.md` / `CLAUDE.md` gates (founder checkpoints, destructive-ops, secrets).
3. Cursor implements; Codex reviews independently — only one edits a working tree at a time.
4. Production and destructive operations remain founder-only.
5. Merge to `main` requires founder authorization.

Live Agentic Engineering GitHub control writes are **not** activated. See CURRENT.md for phase status.
