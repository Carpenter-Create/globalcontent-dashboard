# CLAUDE.md — Global Content Dashboard

> Repo root. Loaded every session on top of the global `~/.claude/CLAUDE.md` (working contract,
> destructive-ops intent, founder checkpoints, verification — inherited, not repeated here).
> Only what's specific to THIS project. Keep under ~200 lines.

## Project Tier
**Tier 3.** Real external users, PII, signed contracts, rights-holder revenue data, payouts.
Full spec, blast-radius review, security rigor.

## What this is
The authenticated client dashboard for **Global Content's Content Distribution pillar**. Rights
holders sign a licensing agreement, submit titles and **platform-ready** assets, track delivery
across vendors, and (later) receive revenue statements and payouts.

**Not** the public site — that's `globalcontent-web`, separate repo, Tier 2. **Not** 24Frame —
separate product, separate repo, separate Supabase project.

## Source of truth
- **`docs/domain-spec.md`** — domain model, roles, rights/territory, terms, fees, rate rules,
  delivery, provenance, v1 scope. **Read before any schema or business-logic work**; migrations
  come from it. It holds the detail this file summarizes. Spec beats reference repos and older code.
- **If a decision isn't in the spec, ask — then record it there in the same PR.**
- Brand canon lives in Drive and the Claude project; the compiled rules below govern here.
  Never mirror canon docs into `docs/`.

## Platform
Single app (Next.js App Router on Vercel). **No monorepo, no `packages/`, no workspaces.**
No mobile. **Its own Supabase project** — never share `globalcontent-web`'s.

## Reference repos — patterns only, never domain, never brand
- **`/Users/adamcarpenter/watershedportal`** — donates auth, **multi-tenant org/membership + RLS
  structure** (the most valuable thing in it), edge-function patterns, dashboard shell,
  data-table primitives, email structure, env/deploy layout.
- **`/Users/adamcarpenter/royalogic`** — **later**, revenue module only: accounting periods,
  statement-to-period assignment, ingestion and lineage patterns.

> **Port the plumbing, redesign the domain.** Both are *music publishing* repos. The businesses
> rhyme — owner submits, we place, money returns, we report — which is what makes cloning
> dangerous: a schema 70% right and subtly wrong, carrying every RLS policy built on it.
> **GC has no multi-party splits** — single-vendor: GC pays the client, the client pays their own
> stakeholders. Never inherit a splits ontology, stakeholder entity, or payee management.
> In doubt about a table? It's domain. About a pattern? Probably fine.

## Golden rules (non-negotiable)
1. **RLS is the authorization layer.** Every table, tenant-isolated by org membership **and role**.
   No table ships without policies. Roles are in the first migration, not a UI toggle.
2. **Nothing is ever deleted** — status changes only. Takedown archives in place: no
   `titles_archive` table, no DELETE.
3. **Sources are immutable.** Vendor reports, executed contracts, client uploads: stored as
   received, hashed, dated. Corrections are new records.
4. **Every derived number carries `source_refs` + `logic_version` + `derived_at`.** Untraceable
   means unfinished. The health score is a derived number.
5. **`audit_log` is append-only** — trigger-populated, UPDATE/DELETE revoked at the permission
   level. First migration. For manual delivery and rights entry it **is** the provenance record.
6. **Terms are records, not columns.** So are rights grants and fees. `contract_terms` is
   effective-dated and immutable; the rate is **snapshotted**, never a FK to `tiers.rate`.
7. **Money is integer cents.** Never floats. Derive the counterparty share by subtraction.
8. **The clickwrap accept writes client-initiated terms (signup/upgrade/downgrade); webhooks/cron write system-initiated terms (lapse/renewal). The math reads terms only.** Stripe never enters the calculation path.
   `effective_from` from the event timestamp, **never `now()`**. Exception — lapse has no event:
   use `lapsed_at + 30 days`. The lapse job must be idempotent.
9. **Transaction date wins; pro-rate only when it's absent.** Pro-rating a source that *had* dates
   is a silent, defensible-looking error.
10. **Anything a user could cheat by editing client code lives in an edge function** — payments,
    term writing, URL signing, fee charges. Never trust the client for terms, fees, or state.
11. **A tier change gates future actions; it never retroactively destroys existing state.**
    Enforce at the point of action, never as a sweep — downgrade and lapse alike. Otherwise
    you're auto-taking-down live titles (spec §6).
12. **Rights are the exception to rule 11 — grants expand, never contract.** Shrinking scope would
    leave GC distributing where it has no rights: infringement, not inconvenience. Less scope =
    takedown ($197/title) + resubmit. **No delivery may exist outside an active grant's scope and
    window — enforce in the database, not the UI.** Territories are **resolved ISO codes, never
    labels**: store `mode` (world|include|exclude) + explicit alpha-2 list. "Europe" shifts.
13. **GC never holds banking or tax identifiers.** Client enters them into **Trolley's widget**.
    Store `trolley_recipient_id`, `payout_status`, `tax_form_status`, masked display only.
14. **S3 keys in Postgres; never URLs.** Signed CloudFront URLs on demand from an edge function.
    Uploads are presigned multipart **direct to S3**, never proxied through the app.

## Deletion — before porting anything from 24Frame
24Frame's rulebook cascades account deletion across all tables. **Correct there, catastrophic
here:** titles, assets, and revenue belong to the **org**, not the user. User deletion removes
`auth.users` + personal PII only, never org-owned records. A departing employee must never
cascade a client's catalog.

## Org roles
`account_owner` (all) · `accountant` (read all; writes tax + banking only) · `legal` (read all,
write nothing) · `delivery_ops` (all operational **incl. rights + territories**; no finance, no
tax) · `viewer` (catalog read-only).

GC-side roles mirror these but **scope inverts** (all orgs) — **prefix them `gc_*`** so a client
policy can't be wired to a GC role by name collision. **View-as-client must be audit-logged
loudly** — it's a service-role backdoor wearing a nice hat.

## Money
- **Stripe money in** (tier subscriptions + fees). **Trolley money out** (payouts, W-9/W-8BEN,
  1099/1042-S). No overlap.
- **Fees are a table, not constants**, and snapshot onto the charge: `downgrade` $197 ·
  `takedown` $197/title · `rights_change` $97 · `upgrade_differential` (computed).
- **Pricing convention: prices end in 7, never 9.** $197, $97 — not $199, $99.
- `downgrade` and `takedown` are **different SKUs at the same price** — never collapse them.
- **No fee on an involuntary downgrade** (lapse). Don't apply the fee rule uniformly.

## Delivery is manual — there are no platform APIs
GC staff deliver by hand: either exporting metadata in a vendor's required format and uploading to
the vendor's own portal, or sending a templated email from the dashboard (signature templated from the
sending GC user's account). **Status is set by a person, not an API ack** — so `audit_log` is the
provenance record; don't model a `source_document` that doesn't exist. **Vendor portal credentials
live in a password manager, never the database.**

**The export mapping is the intake mapping in reverse** — client sheet → canonical is intake,
canonical → vendor format is export. **One mapping engine, not two.**

**Masters go to Glacier Flexible at 90 days** (lifecycle policy, not code — masters only, not
artwork/screeners). Restore takes 5–12h, so **delivery needs a `restoring` state**: no vendor
email until it completes, or you're mailing links that 404.

## Findings and AI
- **One findings store.** The attention queue (push) and Globee (pull) read the same table.
  **Globee reads findings as a tool and never recomputes them**, or the two will disagree.
- **Validator findings and AI findings stay labeled apart** — requirements vs. suggestions. The
  AI's misses must not poison the validator's credibility. **False flags kill the queue:
  precision over recall.**
- **The metadata-mapping AI outputs a MAPPING, not data.** Applied deterministically; saved per
  client and replayed — so it cannot hallucinate a runtime. **AI maps; the zod validator decides.
  Never the reverse.**
- **Globee runs with the user's JWT, never the service-role key.** RLS stops cross-tenant leakage
  — not the system prompt. Reach is scoped tools, not table access. Prompt injection via uploaded
  sheets is not hypothetical; user-JWT + RLS fails closed.

## Two channels
- **Global Content Support** — the institution. **Push only.** Bad news and obligations: payment
  failed, rejection, deadlines, tier changes, expiry. Parent voice.
- **Ask Globee** — the chat surface. **Pull only. Never initiates**, never volunteers an upsell.
  Warm and professional; no preamble, no decoration. Register shifts with stakes — money,
  rejections, deadlines get precision. Cannot advocate against GC: facts, tradeoff, hand off.
- Findings and notifications carry a `sender`: `gc_support` | `globee`.
- **Globee drafts; the client approves their own actions; GC approves anything client-facing.**
  Globee never sets prices, never mails a client unattended, never promises a delivery date.

## Brand guardrails (compiled — full canon in Drive/Claude project)
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

## Voice (compiled — governs UI copy, emails, error states)
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
- **Design tokens only.** Port `tokens.css` from `globalcontent-web`, map via Tailwind `@theme`.
  Never hardcode hex. Do **not** copy watershedportal's palette — that's Watershed brand.
- Real GC accent is a **founder checkpoint** pending the logo. Stay on the neutral placeholder.
- **Logic in `lib/`, not components.** Copy lives in `lib/` content modules, not inline in JSX.

## Security must-nots
- Never expose the Supabase **service-role key** or any AWS/Stripe/Trolley secret to a client bundle.
- Contract terms and rights grants are **GC/Owner-write, role-read — enforced in RLS policy, not
  by hiding the form.** A UI-only rule is not a rule.

## Destructive-Ops Rule (intentionally duplicated — safety; enforced by the hook)
> IMPORTANT: Never run migrations, drop/alter tables, delete rows, revoke permissions, or change
> RLS/auth config without first showing me the exact SQL and getting explicit approval.
> Creating audit triggers and revoking UPDATE/DELETE on `audit_log` are destructive ops.

## Build order (first vertical slice — in this order)
```
auth → org + membership + ROLES + RLS
     → clickwrap accept (assent record + rendered terms as source doc) → contract_terms on accept
     → Stripe tier purchase (paid tiers) → org: active
     → title stub → rights grant → asset upload (multipart to S3)
     → metadata intake (guided form only) → in_review chain-of-title gate (narrow)
     → vendor records → delivery status (manual, GC-updated, grant-gated)
     → findings (validator only) + attention queue → notifications (email + in-app)
     [Trolley recipient setup → first payout, not signup (§16)]
```
`audit_log` + source layer in the **first** migration. Prove multi-tenant, role-aware RLS
end-to-end before widening.

## Do NOT build yet (deferred — design the seam, don't build it)
Revenue/accounting module · statements · payouts · metadata paths 2 & 3 · AI findings · health
score · Ask Globee · dashboard insights · 24Frame entitlement grant · anything public-facing ·
mobile · **transcoding** (clients deliver platform-ready; GC never transcodes).

## Conventions
- UUID PKs (`gen_random_uuid()`), `timestamptz` everywhere, `snake_case`.
- Migrations in `supabase/migrations`; regenerate TS types after schema changes.
- TypeScript strict. Validate inputs at the edge (zod).
- Every new table: definition + indexes + RLS policies + triggers, in one migration.
- Secrets server-only. Run `leak-check` before shipping.

## Known Gotchas (living — durable lessons only)
Append lessons learned in THIS repo that aren't already in the spec. Real lessons only —
restatements crowd out the section's purpose.

- _(none yet)_
