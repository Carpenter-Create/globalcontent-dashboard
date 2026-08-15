# Operational gotchas

Conditionally loaded reference for repository-specific lessons that are not already in
[`docs/domain-spec.md`](../domain-spec.md). Read when the trigger matches your task.

---

## Trigger: Supabase RPC and generated types

**When:** Writing or calling RPCs; regenerating `database.types.ts`; TypeScript rejects a `.rpc()` call.

Supabase `gen types` marks every RPC arg without a `DEFAULT` as required non-null. An optional param
(one you want to pass `undefined`/omit from a `.rpc()` call) MUST be declared `… text default null`
in the SQL, or TS rejects the call. Bake `DEFAULT null` into the param the first time — do not ship
required-arg RPCs and patch with a follow-up migration.

The generator can only emit required-non-null or optional-non-null, never required-nullable —
hand-editing `database.types.ts` to fake the nullable case does not survive the next regeneration,
which reverts it silently and points the resulting build error at the call site, not the function it
actually came from.

Where the argument's meaning is "detach" (clear an existing value), spell that as an **omitted
(`undefined`) argument**, never an explicit `null`.

Prior incidents: `accept_terms`, `add_rights_grant`, `create_asset`, `attach_link_vendor` — all
required `DEFAULT null` fixes in follow-up migrations.

---

## Trigger: Authentication and server components

**When:** Adding auth checks in middleware, layouts, or pages; measuring navigation performance.

Never call `supabase.auth.getUser()` in app code — use `getAuthUser()` / `getOrgContext()` from
`lib/supabase`. `getUser()` is a network round-trip to the Auth server on every call (measured
35–49ms against a local Supabase; worse against hosted). Three calls per navigation — middleware,
layout, page — plus a duplicated memberships query, produced nine sequential round-trips.
`getClaims()` verifies the JWT locally via WebCrypto against a cached JWKS on asymmetric signing
keys (ES256 here) and still refreshes an expired token. Wrapped in React `cache()`, a layout and
its page share one verification. Layout render improved 79ms → 26ms in one remediation pass.

`getOrgContext()` extends this to identity + memberships + gc_staff + unread in one cached,
parallel resolution — a page under `(app)` must never re-query membership the layout already has.

**Independent Supabase queries in a server component must be `Promise.all`'d.** Awaiting them in
sequence costs a full round-trip each. This is the single easiest performance regression to
reintroduce.

---

## Trigger: Local email behavior

**When:** Login magic links or app-sent mail do not arrive during local development.

Local dev has **two email paths** and only one is fake:

- **Supabase Auth** (magic link / login) → the local stack's own SMTP → **Mailpit at
  <http://127.0.0.1:54324>**. Never reaches a real inbox.
- **App email** (portal OTP, GC Support notifications — `src/lib/email.ts`) → **Resend**, from
  `assets@globalcontent.co` → **a real inbox, even from localhost.**

Auth mail is deliberately not routed through Resend: `supabase/config.toml` sets
`auth.rate_limit.email_sent = 2` per hour, which throttles dev logins almost immediately.

---

## Trigger: S3 and build behavior

**When:** `pnpm build` fails at module load; preview deploy fails before serving; S3 head/check
returns unexpected 404.

`src/lib/s3.ts` throws at **module load** if `S3_BUCKET`/`AWS_REGION` are unset — and `next build`
evaluates route modules, so a missing var fails the **build**, not just serving. Over 20 modules
import `@/lib/s3` (directly or transitively), including several route handlers.

**CI does not catch this** — `.github/workflows/ci.yml`'s `checks` job runs `pnpm typecheck` and
`pnpm test`, never `pnpm build`; only a real Vercel deployment attempt would surface it. Both vars
must exist in **every** Vercel environment this app is ever built in, **including preview**.

The guard is intentional: an unset bucket silently became `Bucket: undefined`, which S3 answers
with the same 404 a genuinely missing object gets, misfiring `headObjectMeta`'s absence check.
The consequence — runtime gap becomes build-time failure — needs to be known going in, not
discovered via a failed deploy.

---

## Trigger: Production migration apply (founder-gated wrapper)

**When:** Applying or rehearsing pending dashboard migrations; comparing local files to a
database ledger; choosing a Supabase CLI.

Use [`scripts/db/prod-migrate.sh`](../../scripts/db/prod-migrate.sh) only. It requires
Supabase CLI **exactly 2.102.0** on PATH and never invokes `npx` (bare or pinned). Default
is rehearsal: CLI version and a clean working tree, no database connection, and no
invented pending list. Proven 2.102.0 rehearsal against a database is
`supabase db push --dry-run --local` or `--linked` — that flag exists on 2.102.0;
do not invent another.

`--apply` is founder-only, requires `--target`, and requires typing the confirmation
string generated for the pinned pending set of that run. Agents must not apply,
repair, or mark migrations.

`--apply` also requires `GC_PROD_APPROVED_SHA`: the founder-approved 40-character
commit SHA of the exact release that is checked out. Export it immediately before
production execution. The wrapper will not derive it from `HEAD`, will not accept
a short SHA, and fails closed if the value is missing, empty, malformed, not a
commit in this repository, or not equal to the current `HEAD`. Clean `main` is
still required; the branch name alone is not sufficient.

`--apply` then asks pinned CLI 2.102.0 `db push --dry-run` what it would apply
to the selected target. The wrapper walks that plan line by line using the same
filename grammar as CLI 2.102.0 (`^([0-9]+)_(.*)\.sql$`): any numeric version
length and any suffix the CLI would accept, including hyphens, periods, spaces,
Unicode, and an empty name. Expected banner/info lines are ignored; any other
line fails closed. The complete ordered pending set is whatever that dry-run
reports. The wrapper does not invent or hardcode a pending list. Ambiguous or
unparseable output fails closed. An empty pending set (database up to date) is
a clean stop, not an apply. After typed confirmation the wrapper dry-runs
again; if the pending set changed, it stops and does not `db push`.

The 20260806–20260808 nine were a closed morning release. This wrapper no longer
pins that list. Files present under `supabase/migrations` are not an apply set
by themselves.

Before a production apply of the closed 20260806–20260808 nine:

1. Run [`scripts/security/preflight-screener-active-dupes.sql`](../../scripts/security/preflight-screener-active-dupes.sql)
   as a privileged SELECT. Aggregates only. If `conflicting_title_count > 0`, stop. Do not
   auto-revoke. Founder remediates with separately approved SQL, then re-runs the preflight.
2. Take a current production dump (founder). The 2026-07-27 dump is not sufficient for the
   current ledger.
3. Check out clean `main` at the approved release commit. Export
   `GC_PROD_APPROVED_SHA=<that exact SHA>` and apply only via the wrapper.
4. After apply, run [`scripts/security/verify-nine-20260806.sql`](../../scripts/security/verify-nine-20260806.sql)
   (catalog only) and [`scripts/security/verify-prod-end-state.sql`](../../scripts/security/verify-prod-end-state.sql)
   with the same pinned CLI 2.102.0 (`supabase db query --local` or founder
   `--linked`). Never `npx`.

Do not use `--linked` from an agent session. Never pass `--include-roles`.

`screener_concurrency_test.sql` needs a **superuser** session (`supabase_admin`
on the local image). The `postgres` role is not superuser; `dblink_connect`
then fails 2F003 and `dblink_connect_u` cannot be granted from `roles.sql`.
CI `isolation` writes the ordinary inventory with
`scripts/db/ordinary-pgtap-files.sh > "$inventory"` (every
`supabase/tests/*.sql` except this file). The helper is a normal command;
a nonzero exit is not consumed. Only after that success does CI run
`supabase test db` on the list, then a separate blocking step runs this
harness against the already-started local CI database as `supabase_admin`
with the documented local default credentials (not a production secret).
B3 and L7 run only after both database steps succeed.
A default local `supabase test db` that still discovers this file as
`postgres` must fail closed — do not skip it.

If that test creates `dblink` and then aborts before its owned cleanup, a local
superuser may run `drop extension if exists dblink;` only when no other local
session needs it and no other copy of this harness is running (invocations
serialize the extension lifecycle on a session-level advisory lock). Do not
drop a pre-existing `dblink`. Stale `__pgtap_scc__*` orgs/vendors from a
crashed run are not auto-swept (a sweep would delete a parallel invocation).
Delete only the leftover nonce you own, locally.
