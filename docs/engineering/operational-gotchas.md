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
