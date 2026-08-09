# First-slice implementation spec — auth → org + membership + roles + RLS + provenance

> **HISTORICAL / SUPERSEDED.** This document is preserved as slice evidence. Do **not** use it as
> current implementation authority without fresh verification against the live repository and
> explicit founder authorization. Active operating posture:
> [`docs/status/CURRENT.md`](status/CURRENT.md). Current product and schema doctrine:
> [`docs/domain-spec.md`](domain-spec.md).

> **Status: spec pending founder approval to build.** Produced via `/init` (Step 2–3). No code
> written yet; build begins only on "Approved — begin building."
>
> **This is the operational *how* for the first vertical slice only.** The whole-product spec is
> `docs/domain-spec.md` and remains the single source of truth for *what* — this doc does not
> restate it, it references it. Section refs (§) point at `domain-spec.md`.
>
> **Platform decision:** Supabase Postgres + Supabase Auth (resolves the recommendation in
> `docs/db-platform-decision.md`; that doc and `CLAUDE.md`/`domain-spec.md` get the decision
> recorded in the first build PR).

## Scope of this slice (from §23 build order)

The **first migration** plus the auth wiring that proves multi-tenant, role-aware RLS end-to-end.
`audit_log` + the source layer land in this **first** migration (§18; golden rules 4–5). Prove the
spine before widening.

- **In this slice:** Supabase Auth wiring · **Cloudflare Turnstile on the signup path** · `organizations`
  + lifecycle status · `memberships` + `org_role` (5 roles) + `gc_*` mirror · `member_can()` resolver
  · RLS on every table · `audit_log` (append-only) · `source_documents`/`source_records` (immutable)
  · typed reads + one mutation-as-RPC to prove the write path.
- **Not in this slice:** contracts/e-sign, Stripe, Trolley, titles, rights grants, assets,
  delivery, findings, notifications, and anything Globee/agent (deferred — seam only).

### Scope boundary — deliberately narrower than CLAUDE.md's build order

CLAUDE.md lists the build order through delivery status as one sequence, but the same section
instructs: *"Prove multi-tenant, role-aware RLS end-to-end before widening."* **Stopping this slice
at the RLS + provenance foundation is that instruction applied — deliberate, not an omission.** The
**next slice picks up at `contract_review`** (e-sign webhook → `contract_terms` on signing, §5),
then continues down the build order.

## Architecture decisions (now that platform is chosen)

- **Migrations:** Supabase CLI, `supabase/migrations/` (does not exist yet — created this slice).
  Regenerate TS types after each schema change (CLAUDE.md conventions).
- **Reads:** request-scoped Supabase server client, RLS-enforced by the verified session JWT
  (`auth.getUser()`), per the **rls-data-layer** skill. No service-role in the read path.
- **Writes:** mutations as **SECURITY DEFINER RPCs**, not client-side table writes (rls-data-layer).
  Terms/rights/fees will be RPC-gated in later slices; this slice proves the pattern with one
  membership mutation.
- **Authorization:** single `member_can(user, org, capability)` SECURITY DEFINER resolver — client
  role→capability, `gc_*` staff bypass (all orgs). Ported *pattern* from watershedportal, rewritten
  for the 5 spec roles; **native `auth.uid()`** (no shim). `gc_*` prefix enforced so no client
  policy can bind a GC role by name collision (§22).
- **Agent wall:** deferred with Globee — build **no** `agent` role yet, but keep the proposals-wall
  seam in mind so it drops in later without reshaping RLS.
- **Cloudflare Turnstile (resolved: in this slice, not deferred).** This slice builds the signup
  path and browser-verifies "sign up → session," and signup creates the `registered` free-tier org
  (§3) — the open, uncarded path Turnstile exists to protect. Deferring would leave the slice's own
  verification exercising an unprotected signup and risk the item falling between slices. Scope:
  Turnstile widget on the signup form + **server-side token verification before user/org creation**.
  It remains **queue hygiene, not the security boundary** — §3 manual contract review gates access
  (per `domain-spec.md` §23 note).
- **Skills to run when building:** `supabase-conventions`, `rls-data-layer`, `provenance-spine`,
  `testing-conventions`.

### GC role home — DECIDED: Option A, `gc_staff` table (§22)

The `gc_role` lives in a dedicated **`gc_staff` table** (`user_id → gc_role`) — not on `memberships`
(user↔client-org, where GC staff have no row) and not as a profile flag. Chosen because it closes
§22's name-collision surface **by construction** (a `gc_*` value can never land in a client
`memberships.role`) rather than by policy vigilance, and keeps a global-power field off the identity
row (no self-elevation path). Rejected: **B** rode authorization on an identity row; **C**
reintroduced the collision in `memberships.role` while still needing the bypass. Recorded in
`domain-spec.md` §22.

**Resolver wiring (`member_can(p_user, p_org, p_capability)`, SECURITY DEFINER, native `auth.uid()`):**
1. **GC staff bypass first** — `if exists (select 1 from gc_staff where user_id = p_user)` → return
   true (GC scope spans all orgs; the `gc_role` value drives finer capability checks as GC-side
   surfaces are built). Reads `gc_staff`, never `memberships`.
2. **Otherwise client path** — look up `memberships` for `(p_user, p_org)` with active status, then
   role→capability (viewer=read; delivery_ops=operational incl. rights/territory; accountant=read +
   tax/banking; legal=read-only; account_owner=all).
3. **`gc_staff` and `memberships` never mix** — two relations, one resolver; the `gc_*`/`org_role`
   enums are distinct types, so a value from one cannot be stored in the other's column.

## First migration — contents

Every table ships with definition + indexes + RLS policies + triggers in one migration (CLAUDE.md
conventions):

- **Enums:** `org_role` (account_owner, accountant, legal, delivery_ops, viewer), `gc_role` (`gc_*`
  mirror), `org_status` (registered → contract_review → signed → onboarding → active →
  payment_lapsed / closed). Distinct enum types — a `gc_*` value cannot be stored in an `org_role`
  column.
- **`organizations`** — status, `dunning_hold`, Trolley placeholder columns (masked-display only,
  §16), timestamps.
- **`memberships`** — user↔org+role(`org_role`)+status; a user leaving never cascades org data (§11
  deletion rule).
- **`gc_staff`** — `user_id → gc_role` (§22 decision). GC-side identities; the `member_can()` staff
  bypass reads this, never `memberships`.
- **`audit_log`** — append-only, trigger-populated, **UPDATE/DELETE revoked at the permission
  level** (destructive-op — exact SQL shown for approval before applying, per the hook + rule).
- **`source_documents` / `source_records`** — immutable, write-once, `content_hash`, `received_at`,
  `provided_by`.
- **`member_can()`** + RLS policies on all of the above.

## Security (Tier 3)

- RLS is the authorization boundary — no table without policies. Tenant isolation by org membership
  **and** role.
- `gc_*` scope-inversion (all orgs) with name-collision protection.
- View-as-client is a later GC capability, but **any** service-role backdoor is audit-logged loudly
  when it lands (§22).
- Secrets server-only; `.env*` already denied by `settings.json`; `leak-check` before shipping.

## AI

None in this slice. Globee/agent deferred (§23). No prompts, no model calls. Seam only.

## Risks

- **Getting RLS subtly wrong** = cross-tenant leak (Tier 3, revenue-adjacent). Mitigation: pgTAP
  tests written as an adversary (below), before widening.
- **`audit_log` write path** must be trigger-populated and tamper-proof from day one — retrofitting
  loses history permanently (§18).
- **Migration is destructive-op territory** (revoking UPDATE/DELETE, triggers) — gated behind
  explicit approval of exact SQL.

## Verification strategy (Step 3)

| Area | How | Auto/Manual |
|---|---|---|
| RLS tenant isolation | pgTAP: org A member cannot SELECT/INSERT/UPDATE org B rows; role→capability matrix (viewer can't contribute, only owner manages team); `gc_*` sees all | **Auto**, fails loudly |
| `audit_log` append-only | pgTAP: authenticated UPDATE/DELETE on `audit_log` raises; trigger writes before/after on a sample mutation | **Auto** |
| Source immutability | pgTAP: UPDATE/DELETE on `source_documents` raises | **Auto** |
| Mutation-as-RPC | node:test/integration: RPC enforces `member_can`; client-side table write is rejected | **Auto** |
| Turnstile on signup | Server rejects a signup POST with a missing/invalid token before any user/org row is created; valid token proceeds | **Auto** + **Manual** (browser signup) |
| Auth flow end-to-end | Sign up → session → land in a role-scoped view; **used in a browser**, not just tests | **Manual** (founder, after build) |
| Secret leakage | `leak-check` on the client bundle | **Auto** |

## Authorization gate (Step 4)

Build begins only on **"Approved — begin building."** First action will be the first migration —
the exact SQL for the `audit_log` revokes/triggers shown for approval before applying, per the
destructive-op rule.
