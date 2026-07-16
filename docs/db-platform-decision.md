# DB platform & org-model analysis — Aurora vs Supabase Postgres

> **Status: analysis + recommendation only. Not a decided architecture.** Final DB platform is a
> founder infrastructure checkpoint (`CLAUDE.md` → founder checkpoints: "final architecture &
> launch calls"). This doc pressure-tests the spec's current choice (Supabase Postgres); it does
> not override it. If the decision lands on Aurora, `docs/domain-spec.md` and `CLAUDE.md` get
> updated in the same PR that records it.
>
> Grounded in a read-only audit of `/Users/adamcarpenter/watershedportal` (canonical Aurora path
> in `packages/db/`), not the port inventory's summary. File citations are watershedportal's.
>
> **Scale premise (updated):** projecting **hundreds of thousands of users**. This supersedes the
> earlier ~50-org figure and is integrated below. See the **Key unknown** callout — the
> recommendation's strength depends on *concurrency*, not registered-user count.

---

## The decisive reframe

watershedportal's authorization architecture is **not "Aurora architecture."** It's
**direct-Postgres-connection RLS architecture** that happens to run on Aurora. Every load-bearing
piece — `member_can()`, `withUser`/`withAgent`, the agent wall — is plain Postgres: SECURITY
DEFINER SQL, `SET LOCAL ROLE`, transaction-scoped `set_config` GUCs, custom LOGIN roles, GRANT/
REVOKE. None of it uses an Aurora-specific feature. It reaches the DB via postgres.js + Drizzle on
a **direct connection** (`packages/db/src/client.ts`), **not PostgREST**.

The one piece that exists *only because of Aurora* is `migrations/0000_auth_shim.sql` — a
hand-rolled reimplementation of `auth.uid()`/`auth.role()`, written because Aurora isn't Supabase
and doesn't provide them. **On Supabase Postgres you delete that shim** — Supabase provides
`auth.uid()` natively, reading the same kind of GUC `withUser` already sets.

So this is not "port the Aurora stack or rewrite for Supabase." The valuable pattern is
infrastructure-agnostic, and it ports **more cleanly** onto the Supabase Postgres our spec already
mandates than back onto the Aurora it came from. **watershedportal is also live proof the reverse
migration works** — it started on Supabase and moved to Aurora carrying this exact pattern. That
makes "start on Supabase, migrate later if scale demands" a *demonstrated* low-risk path, not a bet.

---

## Q1 — Aurora + Drizzle + Supabase Auth (a) vs Supabase Postgres + Supabase Auth (b)

### member_can / withUser+withAgent / proposal wall — port verbatim or rewrite?

| Piece | (a) Aurora + Drizzle + Supabase Auth | (b) Supabase Postgres + Supabase Auth |
|---|---|---|
| **`member_can()`** (`…190100_member_can_resolver.sql:4-25`) | Verbatim. `language sql stable security definer` over `client_account_members`; zero Aurora coupling. | **Verbatim.** Only edit either way: rename `client_accounts`→`organizations`, `owner/team/viewer`→the 5 spec roles. |
| **`withUser`** (`client.ts:124-140`) | Verbatim, **including** the `auth.uid()` shim it depends on — which you keep maintaining. | **~10-line rewrite, net simpler.** Set `request.jwt.claims` in the transaction so Supabase's **native** `auth.uid()`/`auth.role()` fire, instead of custom `app.user_id`/`app.role` GUCs + shim. **Delete `0000_auth_shim.sql`.** RLS then reads identically whether hit by a direct connection or PostgREST. |
| **`withAgent` + agent wall** (`agent.ts`, `0003…spine.sql`, `0004…staff_access.sql`, `0006…durability.sql`) | Verbatim. Custom `agent` LOGIN role + `AGENT_DATABASE_URL` + narrow GRANTs + `TO agent` RLS + `approve_*` SECURITY DEFINER RPCs. | **Verbatim.** Supabase's DB is just Postgres — `CREATE ROLE agent`, narrow GRANTs, separate connection string all port unchanged. |

**Bottom line:** (b) is *less* rewrite than (a). (a) forces you to carry the shim **plus** a
Supabase-Auth→Aurora user-mirror bridge (`provisionAuroraUser`, already flagged for stripping in
the port inventory). (b) drops the shim and runs one database.

### Can Supabase's role model support the powerless-agent wall without bypassing PostgREST?

The premise dissolves once you know the data path: **watershedportal doesn't use PostgREST for
data at all** (verified — the only `supabase.from(`/`supabase.rpc(` hits are dead comments
describing the *replaced* flow). The agent never touches PostgREST.

To the question directly: **the three built-in roles cannot express the wall, and you should not
try to make them.**
- `anon` / `authenticated` — the PostgREST/JWT roles; `authenticated` can do everything a signed-in
  human can. Too broad.
- `service_role` — **bypasses RLS.** Giving the agent this is the exact failure the spec bans
  ("Globee runs with the user's JWT, never the service-role key").

**The equivalent is a *fourth, custom* Postgres role** — exactly what watershedportal does:
`CREATE ROLE agent NOLOGIN` (login credential provisioned out-of-band via `provision-agent-role`),
granted only `INSERT/SELECT/UPDATE on proposals`, `INSERT/SELECT on proposal_messages`, and
`SELECT` on `public_*` **views** (never base tables), with `TO agent` RLS that can never set
`status='approved'` and is locked out once a human moves the proposal to `in_review`
(`0003…spine.sql:68-116`). Humans commit via SECURITY DEFINER `approve_*` RPCs that assert
`is_company_user or is_platform_admin` and are re-sealed with `revoke execute … from public`
(`0004…staff_access.sql:37-79`); `0006_agent_wall_durability.sql` flips default privileges so new
functions fail closed.

This is fully supported on Supabase Postgres (it *is* Postgres) and is arguably a *better* fit
there: PostgREST can't easily expose a custom role, so a direct-connection-only agent is the
natural, fail-closed shape. The `SET LOCAL` / transaction-scoped pattern is also pooler-safe
(Supavisor transaction mode). *Confirm at build time (not a blocker): a custom LOGIN role
connecting through the Supabase pooler — standard, but smoke-test early.*

### What we lose from Supabase by going Aurora — and do we use it?

Verified against watershedportal, the closest proxy we have:

| Supabase feature | Used by the app? | Impact of losing it |
|---|---|---|
| **PostgREST** (auto REST API) | **No** — all data is direct Drizzle→DB. | **Zero.** Supabase's headline feature is unused here. |
| **Realtime** | **No** — grep for `.channel(`/`postgres_changes` returns nothing. | Minor. In-app notifications/attention queue *could* use it; React Query polling covers v1. |
| **Storage** | **Barely** — one 5MB `help-articles` image bucket (`packages/lib/src/lib/storage.ts:31-66`). Domain media is direct-to-S3 presigned. | Trivial. Put small images on S3 too. |
| **Edge Functions** | Mixed (Supabase Deno + AWS Lambda). This repo deploys on **Vercel**, so route handlers/Vercel Functions + Lambda for media fit regardless. | Neutral either way. |

"We'd lose Supabase features" is a **weak argument for Aurora** — we use almost none of the data
plane. It also cuts the other way: Supabase Postgres gives us everything we *do* use (Auth +
Postgres + RLS) plus Realtime/Storage for free if ever wanted, so there's no capability gained by
leaving.

### Media uploads (confirmed)

Large domain media is **direct-to-S3 via presigned PUT**, not Supabase Storage
(`packages/edge-functions/src/media-upload/handler.ts`, `apps/web/components/releases/media-upload.ts:70-106`).
Signing uses the Lambda execution role (no static keys). Same on either DB option.

### VPC / IAM / private networking (Tier 3, revenue data)

Aurora's one real edge — and it's **largely neutralized by deploying on Vercel.**

- **Aurora** can live in private subnets with no public endpoint, IAM auth, security groups, KMS —
  gold-standard isolation *if compute is also in the VPC*. But **Vercel compute is not in your AWS
  VPC.** Reaching a private Aurora from Vercel needs RDS Proxy + PrivateLink/secure-compute +
  static egress IPs, or a NAT gateway, or moving compute into AWS. You cross a managed public
  boundary anyway — paying the VPC complexity without clean end-to-end private networking.
- **Supabase** is a managed, TLS-only, credentialed Postgres endpoint with IP allow-listing /
  network restrictions on paid tiers, encryption at rest, SOC 2 (HIPAA on higher tiers). Not in
  *your* VPC, but for a Vercel-fronted app the defense-in-depth is the same shape it'd be for
  Aurora-from-Vercel: **RLS is the real authorization boundary** (spec golden rule #1), backed by
  encryption + access control.

Net: Aurora's isolation advantage only materializes if compute also moves to AWS — a bigger
departure than the DB choice, and contrary to the Vercel deployment in `CLAUDE.md`. **At hundreds
of thousands of users the blast radius is larger and this argument gains weight — but only if
paired with in-VPC compute.**

### Scale — hundreds of thousands of users

> ### ⚠️ Key unknown that determines the recommendation
> **Registered users ≠ concurrent load.** A B2B rights-holder dashboard with hundreds of thousands
> of *registered* users likely has thousands, not hundreds of thousands, *concurrent*. The DB
> decision hinges on peak concurrency + write throughput (audit_log, findings, catalog events),
> which we don't yet have. The branches below depend on it.

- **Moderate concurrency (thousands, bursty).** Both handle it. Supabase on a large dedicated
  instance + read replicas + Supavisor pooling is designed for this; Postgres at this scale is a
  design problem (pooling, indexing, `audit_log`/`catalog_events` partitioning, stateless compute),
  not a platform problem. Recommendation holds.
- **High/sustained concurrency or very high write throughput.** Aurora's ceiling gets materially
  stronger: Serverless v2 autoscaling to 128 ACU, storage auto-scaling to 128 TB, up to 15 read
  replicas, global database, mature scale tooling (Performance Insights, RDS Proxy). If this is the
  real projection, the recommendation weakens toward (a) — a founder-level call.

Either way, **design scale-aware from day one** regardless of platform: transaction-scoped pooling
(already the pattern), partition high-churn append tables, keep compute stateless, and avoid
Supabase-proprietary lock-in beyond Auth so the Aurora exit stays open. watershedportal proves that
exit is real and low-risk.

**Auth is a separate cost/scale checkpoint (independent of the DB choice — both options use
Supabase Auth).** Supabase Auth is MAU-priced; at hundreds of thousands of MAU this becomes a
material monthly line item on *either* option, and may warrant its own review (Team/Enterprise tier
vs self-hosted GoTrue vs an alternative). Flagging, not re-litigating — the spec says Supabase Auth.

### Rough monthly cost

At **~50 orgs** (the old premise) Supabase was clearly cheaper (~$25–100/mo, one system) vs Aurora
(~$150–300+/mo across Supabase Auth + Aurora + bridge). **At hundreds of thousands of users, cost
is no longer the differentiator** — it's dominated by real concurrency, which we don't have. Order
of magnitude, both land in **low-thousands+/mo**:

- **(b) Supabase:** Team/Enterprise tier + large dedicated compute add-on + read replica(s) +
  MAU-based Auth overage → **roughly low-thousands/mo**, one system.
- **(a) Aurora:** Serverless v2 at load + RDS Proxy + read replicas + NAT/networking + **still
  Supabase Auth MAU cost** + bridge maintenance → **roughly low-thousands/mo**, three moving parts.

Cost should not drive this decision at scale; concurrency and operational model should.

### Recommendation (you decide)

**Lean (b), Supabase Postgres + Supabase Auth — but at this scale it is now genuinely closer and is
a real founder infrastructure checkpoint, not a slam dunk.**

The reasoning that anchors it is unchanged by scale: the pattern we want is infrastructure-agnostic
and lands *more cleanly* on Supabase (delete the shim; `member_can`/agent-wall verbatim; `withUser`
~10-line change; one system instead of Auth+Aurora+bridge). We lose no feature the app uses;
Aurora's network-isolation edge is neutralized by Vercel; and it matches what `CLAUDE.md` and the
spec already specify. Crucially, **watershedportal is proof you can start on Supabase and migrate
to Aurora carrying this exact pattern** — so choosing (b) now does **not** foreclose Aurora later,
and defers Aurora's operational complexity until concurrency actually demands it (YAGNI, with a
proven exit).

**Flip toward (a) if:** you have concrete near-term peak-concurrency / write-throughput numbers
that exceed a large Supabase instance + read replicas; **or** compute is moving into AWS (making
private-VPC Aurora genuinely private end-to-end and turning the Tier-3 isolation argument real);
**or** you'd rather pay the migration cost once up front than twice, given a firm high-scale
projection.

The porting rule still applies exactly: **port the pattern (direct-connection RLS + agent wall),
not the infrastructure choice.**

---

## Q2 — tenants vs client_accounts

**Keep `client_accounts` / `client_account_members`. `tenants` / `tenant_memberships` do not port.**

Verified in code, not inferred:
- The single canonical resolver `member_can()` queries **only** `client_account_members` on
  `client_account_id` (`…190100_member_can_resolver.sql:14-21`) — no `tenant_memberships` branch.
- The actively-developed domain surface (releases, recordings, artists, members, proposals,
  assets — all June-2026 migrations) scopes by `client_account_id` via `member_can(...)` /
  `get_user_client_accounts(auth.uid())`. `client_account` appears in 11 Aurora migrations;
  `tenant_membership` in **0**.
- Drizzle domain code references `clientAccounts`/`clientAccountMembers`, never the tenant tables.

**Caveat to carry into the port (not before):** the introspected snapshot still shows legacy
`tenant`-based policies (`is_active_member`, `is_tenant_admin`) on *peripheral* tables — `contracts`,
`invoices`, `api_tokens`, `audit_logs`, licensing — which watershedportal is mid-way through
hardening/revoking. Those are exactly the tables the port inventory marks EDITS. **When porting any
of them, do not carry their tenant-based RLS** — rewrite to `member_can` / `client_account`
(renamed to `organizations` per spec §3). Porting the table together with its stale tenant policy
is how the vestigial pair sneaks back in.

Net: one org model on the port — `client_accounts` → `organizations` — and `member_can` is the
authorization spine to bring across.
