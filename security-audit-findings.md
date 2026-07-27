# Global Content Dashboard — Security Coverage Matrix Results

**Repo:** `globalcontent-dashboard` (Tier 3) · **Branch:** `security-audit-2026-07-26`
**Date:** 2026-07-26 · **HEAD:** `7a3b5e3` (`feat(shell): tighter sidebar + collapse-to-rail chevron (#39)`)
**Scope:** every row of `security-coverage-matrix.md`, assessed against this repo only.
**Nothing was fixed, no migration was run, no source file was edited.** The one file added is the
B3 test harness at `scripts/security/b3-cross-org-isolation.mjs`.

---

## How each row was verified

| Method | Used for |
|---|---|
| Live negative test against a running Postgres + PostgREST, with real Supabase JWTs | B3, B4, B5, B11, C8, C9 |
| Live `psql` introspection of the applied schema (`pg_policies`, `pg_proc`, `information_schema`) | B1, B2, B8, and every RLS/grant claim |
| Live AWS API calls under the `gc` CLI profile (read-only) | F1, F2, F3 |
| Source inspection with file:line citations | the rest of B, D, E, F, G |
| Build + `pnpm typecheck` + `pnpm test` + `pnpm audit` | D1, H2, H3 |
| Full git-history blob scan (233 commits, all reachable blobs) | D3 |

### Environment caveats — read these before trusting a row

1. **The local database is four migrations behind `main`.** Applied high-water mark is
   `20260721000200`; present-but-unapplied are `20260721000300_screener_share_token`,
   `20260721000400_org_notification_recipients`, `20260722000100_asset_kind_add_poster_banner`,
   `20260722000200_backfill_artwork_to_poster`. Applying them was out of scope (instruction: do not
   run migrations). So **B1/B2's table and policy inventory describes the schema at
   `20260721000200`, not at `main`.** Four objects are therefore unaudited: the
   `portal_links.screener_share_token` column, the `org_notification_recipients` RPC (already called
   from `src/lib/email.ts:80` — so it is live code against an unapplied migration), and the
   `poster`/`banner` values of `asset_kind` (already accepted by
   `src/app/api/assets/initiate/route.ts:10`). Re-run this audit after applying them.
2. **This repo has no public marketing surface.** Rows A1/A2 (privacy policy, published ToS)
   belong to `globalcontent-web`; they are marked OUT-OF-REPO rather than MISSING.
3. **Sections not yet built** (revenue, payouts, referrals, fees, Trolley, AI findings) are marked
   N/A-NOT-BUILT with the seam noted. They are not passes; they are absences.
4. Rows requiring a console login (Section I, plus Stripe/Resend/Vercel/Supabase-prod settings) are
   marked OUT-OF-REPO with the exact thing to check.

---

# PRIORITY FINDINGS (requested first)

## B3 — Cross-org isolation: **DONE**, proven by live negative test

Not inferred from policy text. `scripts/security/b3-cross-org-isolation.mjs` seeds two fully
populated orgs, authenticates as an Org A member with a real Supabase JWT, and drives **134
attempts** through PostgREST — the same surface the browser uses.

```
$ node scripts/security/b3-cross-org-isolation.mjs
PASS       (correctly blocked / empty, non-vacuously): 130
FAIL       (real isolation or privilege breach):       4
VACUOUS    (no bait row — proves nothing):             0
INCONCLUSIVE (harness error, authz not reached):       0
exit=1
```

**Cross-tenant result: 110 attempts, 0 breaches.**

| Section | Attempts | Breaches |
|---|---|---|
| 1. Cross-org READS as Org A `account_owner` | 38 | 0 |
| 1b. Cross-org READS as an authenticated user with no org at all | 16 | 0 |
| 2. Cross-org direct table WRITES | 33 | 0 |
| 3. Cross-org RPC attempts (incl. org/title spoofing) | 23 | 0 |
| 4. B4/B5 role escalation *(3 failures — all within-org, see below)* | 21 | 3 |
| 5. C8 live-session behaviour | 2 | 0 |
| 6. C9 org orphaning *(1 failure)* | 1 | 1 |

**All four failures are within-org role-scope issues (B4) and C9. None is a tenancy breach.**

Two things the harness does to avoid reporting false results, both of which changed the outcome
during this audit:

- **A write only counts as a breach if rows actually changed.** PostgREST answers `200 []` when RLS
  filters an `UPDATE`/`DELETE` to zero rows. My first draft scored those as breaches and reported 14
  failures; ten of them were RLS working correctly. Every write attempt is now confirmed by an
  independent service-role re-read of the target row
  (`scripts/security/b3-cross-org-isolation.mjs:61-95`).
- **An empty read only counts as evidence if the row existed.** Every read test first asserts, as
  `service_role`, that Org B actually has a matching row; otherwise it reports VACUOUS
  (`scripts/security/b3-cross-org-isolation.mjs:102-127`). This is why the harness seeds the GC-side
  chain through the real GC RPCs — `service_role` has no `INSERT` on `deliveries`, `portal_links`,
  `title_reviews`, `export_records`, or `works`, so there is no shortcut. Sample output:
  `R10 SELECT audit_log WHERE org_id = <OrgB> → 0 rows returned; 25 matching row(s) DO exist`.

The attacks that matter most, and what actually happened:

| Attack | Result |
|---|---|
| `SELECT assets WHERE id = <B's asset>` — leak the storage key of another client's master | `0 rows` (1 row exists) |
| `SELECT titles(id, assets(storage_key))` — reach B's asset through a PostgREST embed | `0 rows` (2 rows exist) |
| `SELECT deliveries(*, portal_links(token_hash))` — reach a master-download token via a join | `0 rows` (4 rows exist) |
| `SELECT audit_log` unfiltered — `before`/`after` carry every column of every table | `0 rows` (25 B rows exist) |
| **Spoof:** `set_title_metadata(p_org_id = OrgA, p_title_id = B's title)` | `P0001 Title does not belong to this organization` |
| **Spoof:** `create_asset(p_org_id = OrgA, p_title_id = B's title)` | `P0001 Title does not belong to this organization` |
| **Spoof:** `add_rights_grant(OrgA, B's title, exclusive)` | `P0001 Title does not belong to this organization` |
| **Spoof:** `submit_title(OrgA, B's title)` / `reconcile_title_findings(OrgA, B's title)` | rejected, title/org mismatch |
| `UPDATE organizations SET trolley_recipient_id WHERE id = OrgB` — payout redirect | `0 rows`; re-read confirms unchanged |
| `INSERT memberships (org_id = OrgB, me, account_owner)` — join another org | `42501 violates RLS policy` |
| `UPDATE memberships SET org_id = OrgB` — walk my own row across tenants | `42501 violates RLS policy` |
| `UPDATE memberships SET status='removed'` on B's owner — org takeover | `0 rows`; re-read confirms unchanged |
| `INSERT notifications (org_id = OrgB)` — impersonate GC Support to another client | `42501 permission denied` |
| `rpc create_portal_link(B's asset)` / `create_screener_link(B's title)` — mint a link to their master | `P0001 Not authorized` |
| `rpc finalize_paid_signup(OrgA, premium)` — the money path | `42501 permission denied for function` |
| `rpc portal_resolve_download` / `portal_resolve_screener` | `42501 permission denied for function` |

The structural reason it holds: every policy routes through one resolver, `member_can()`
(`supabase/migrations/20260716000100_init_org_membership_roles_rls_provenance.sql:164-187`), and every
write RPC re-checks `member_can(…,'operate')` **and** that the title belongs to the passed org — e.g.
`create_asset` and `set_title_metadata` both carry an explicit
`if not exists (select 1 from titles where id = p_title_id and org_id = p_org_id) then raise`. The
`org_role` enum also has no `gc_*` values, so `INSERT memberships … role='gc_account_owner'` is
rejected by the type system (`22P02`) before any policy runs.

Note also `supabase/tests/rls_tenant_isolation_test.sql` — a pgTAP tenant-isolation test already
exists in-repo and correctly drops to `set local role authenticated`. It is **not run by CI**: the
only workflow is `.github/workflows/migration-drift.yml`.

## B6 — Service-role reach: **PARTIAL**

The key never reaches a client bundle — that part is clean and verified:

- `src/lib/supabase/admin.ts:1-15` — `import "server-only"` and `SUPABASE_SERVICE_ROLE_KEY` read at
  line 12.
- Only 7 importers, all server-side: `src/app/api/stripe/webhook/route.ts:5`,
  `src/app/api/portal/{request-otp,verify-otp,download,screener,screener-event}/route.ts`,
  `src/app/portal/[token]/page.tsx:1`.
- Fresh production build, then `grep -rl -a` over `.next/static` for `sk_`, `whsec_`, `AKIA`,
  `SUPABASE_SERVICE_ROLE`, `BEGIN PRIVATE KEY`, `CLOUDFRONT_PRIVATE_KEY`, `RESEND_API_KEY`,
  `TURNSTILE_SECRET`, and the string `service_role`: **zero matches.**

The PARTIAL is the second half of the row — "or an edge path a client can invoke". **Six of the seven
service-role call sites are on unauthenticated, publicly reachable paths.** `src/lib/supabase/middleware.ts:36-43`
deliberately exempts `/portal` and `/api/portal/*` from the session gate, so anyone on the internet
can `POST /api/portal/download` and reach RLS-bypassing code. Each one does gate before it acts, and
I traced all six:

| Route | Gate before any service-role read/write |
|---|---|
| `request-otp/route.ts:25` | Turnstile verified server-side **first**, then link token hash, then 1h issuance caps (lines 41-58) |
| `verify-otp/route.ts:20-48` | link token hash → unconsumed OTP → expiry → attempt cap → `safeEqualHex` constant-time compare |
| `download/route.ts:14-19` | `portal_resolve_download(session_hash)` raises unless session **and** link are live, the delivery is `pending/delivered/live`, **and** the grant still covers territory + window |
| `screener/route.ts:12-14` | `portal_resolve_screener(session_hash)`, same shape |
| `screener-event/route.ts:16-21` | session cookie → `portal_resolve_screener` before the insert |
| `portal/[token]/page.tsx` | URL token hash lookup only |
| `stripe/webhook/route.ts:19-24` | `stripe.webhooks.constructEvent` before anything else |

So the design is sound but the blast radius is real: a bug in any one of those six handlers is an
RLS bypass, not a 403. The `authenticated`-JWT surface (`src/lib/supabase/server.ts`) never touches
the admin client. Recommend treating those six files as a change-control tier of their own.

## F1-F5 — S3 / CloudFront access

Verified live against the GC AWS account (read-only calls, `AWS_PROFILE=gc`).

| ID | Status | Evidence |
|---|---|---|
| F1 | **DONE** | Both buckets (`gc-content-assets-dev`, `gc-content-assets-prod`): `get-public-access-block` returns all four of `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` = `true`. Bucket ACL grants: owner `FULL_CONTROL` only, no `AllUsers`/`AuthenticatedUsers` URI. `get-bucket-policy-status` on prod → `IsPublic: false`; dev has no bucket policy at all. Default encryption `AES256` on both; prod versioning `Enabled`. |
| F2 | **DONE** | Prod bucket policy is a single `AllowCloudFrontOAC` statement: `s3:GetObject` to principal `cloudfront.amazonaws.com`, conditioned on `AWS:SourceArn = arn:aws:cloudfront::469511672937:distribution/E2AGBND4FJRHBT`. Nothing else can read the bucket. `list-distributions` shows exactly one distribution, alias `delivery.globalcontent.co`, and its default cache behaviour has **`TrustedKeyGroups.Enabled: true`** (key group `fe99aa8a-786a-428a-9222-4cb4d9ca3094`), `ViewerProtocolPolicy: redirect-to-https`, `AllowedMethods: [HEAD, GET]`. Signed URLs are actually enforced, not decorative. In code, no S3 URL is ever constructed for the client: `grep 'amazonaws'` over `src/**/*.tsx` → 0 hits; `grep 'storage_key'` over `src/**/*.tsx` → 0 hits. Every client-facing URL comes from `signAssetUrl` (`src/lib/cloudfront.ts:12-23`). |
| F3 | **DONE** | Signed per **single object key**, not a prefix: `signAssetUrl` builds `url: ${domain}/${key}` and passes `dateLessThan` (`src/lib/cloudfront.ts:17-22`) — a canned policy over one path, so one URL cannot walk a prefix. TTLs: 300 s for master download, 6 h for screener streaming, both in `src/lib/portal.ts:8-12`, with the reason for the longer one documented (range GETs re-validate on every request across a full runtime). GC internal viewer uses the same two values (`api/gc/asset-url/route.ts:43`, `api/gc/screener-url/route.ts:59`). |
| F4 | **DONE** | The key is **derived server-side and never accepted from the client**: `assetKey()` builds `orgs/{orgId}/titles/{titleId}/{kind}/{randomUUID}/{sanitised-filename}` where `orgId` comes from `resolveOperableTitle()`, not the request (`src/lib/assets.ts:8-16`, `28-49`; `api/assets/initiate/route.ts:27-30`). On the two routes that *do* take a key back from the client, it is re-bound to the caller's namespace before signing: `if (!key.startsWith(\`orgs/${op.orgId}/titles/${titleId}/\`)) return 400` — `api/assets/sign-parts/route.ts:29-30` and `api/assets/complete/route.ts:32-33`. `create_asset` then re-checks title↔org at the DB layer. **Runtime caveat:** the presigned-URL scope itself (that S3 rejects a PUT outside the signed key) was not exercised — that needs live AWS credentials and a real upload. |
| F5 | **DONE** | Every path segment is a v4 UUID plus a per-upload `crypto.randomUUID()` (`src/lib/assets.ts:15`). Nothing sequential or title-derived is in the path; the human filename is a cosmetic tail, sanitised to `[A-Za-z0-9._-]` and truncated to 120 chars. The one sequential identifier in the schema, `titles.catalog_no`, never appears in a key. |

## G1-G5 — Webhook verification

| ID | Status | Evidence |
|---|---|---|
| G1 | **DONE** | `src/app/api/stripe/webhook/route.ts:19-24` — `stripe.webhooks.constructEvent(body, sig, secret)` inside `try`, `return 400` on throw. It is the first thing after reading the body; no DB call, no admin client, nothing precedes it. Missing signature *or* missing secret also 400s (lines 11-15), so an unset `STRIPE_WEBHOOK_SECRET` fails closed rather than skipping verification. |
| G2 | **N/A-NOT-BUILT** | No Trolley integration exists. `grep -rin trolley src/ --include='*.ts'` returns only three generated `database.types.ts` lines for the `organizations.trolley_recipient_id` column. There is no inbound Trolley route to verify. Seam: `organizations.trolley_recipient_id / payout_status / tax_form_status / payout_display` (`20260716000100_…:63-75`). |
| G3 | **DONE** | No GoHighLevel inbound path — and no GoHighLevel code at all. `grep -rin 'gohighlevel\|ghl' src/ docs/` returns only false positives (`ONBOARDING_HIGHLIGHTS`, a CSS `data-[highlighted]` selector). Full route inventory is 15 handlers under `src/app/api/` plus `auth/callback`; the only ones an unauthenticated caller can reach are `/api/portal/*` and `/api/stripe/webhook` (`src/lib/supabase/middleware.ts:36-43`). |
| G4 | **DONE** | `finalize_paid_signup` is idempotent three ways (`20260717000100_clickwrap_stripe_contract_terms.sql:218-251`): the subscription insert is `on conflict (stripe_subscription_id) do nothing` (unique constraint confirmed live as `subscriptions_stripe_subscription_id_key`); the terms insert is guarded by `if not exists (select 1 from contract_terms where source_document_id = p_source_document_id)`; the activation is `update … where id = p_org and status = 'awaiting_payment'`, so a replay is a no-op. Replaying the same event cannot double-provision or double-write a term. **Caveat:** idempotency lives in this one RPC, not in a `processed_webhook_events` table — the handler only acts on `checkout.session.completed` today, so the next event type added has to re-derive its own idempotency. |
| G5 | **DONE** | `const body = await req.text()` at `webhook/route.ts:17` — raw string, before any parse, and it is that exact string passed to `constructEvent`. Nothing mutates it. No middleware body parsing intervenes: the route is exempted from the session gate at `src/lib/supabase/middleware.ts:43` (`path === "/api/stripe/webhook"`), and `updateSession` never reads the body in any case. |

---

# FULL MATRIX

## A. Legal and data handling

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | Privacy policy published and reachable | **OUT-OF-REPO** | No `/privacy` route exists here — `src/app` contains only `(app) actions.ts agreement api auth globals.css layout.tsx login onboarding portal tokens.css`. This is the authenticated portal; the public policy pages belong to `globalcontent-web`. **To check:** that `globalcontent-web` publishes them and that this app links to them from the clickwrap and footer (it currently links to neither). |
| A2 | ToS published; clickwrap references the live version | **PARTIAL** | The clickwrap machinery is real and correct: `TERMS_VERSION` and `renderAgreement(tier)` in `src/lib/agreements.ts:9,39+`, hashed and stored as an immutable source document by `accept_terms` (`20260717000100_…:190-199`). But the version string is `"2026-07-placeholder"` and the agreement body is explicitly `PLACEHOLDER` (`src/lib/agreements.ts:4-6`). It references no published ToS URL. **Cannot pass until counsel's text lands** — and a Tier-3 clickwrap accepted against placeholder text is not enforceable evidence. |
| A3 | Data inventory | **MISSING** | No inventory document exists. Partial facts recoverable from the repo: Supabase prod project `uevsculwzwlhxeamagwg` (`.github/workflows/migration-drift.yml`); S3 `gc-content-assets-{dev,prod}` in `us-east-1` (verified live); CloudFront `E2AGBND4FJRHBT` / `delivery.globalcontent.co`; third parties receiving data = Stripe (`src/lib/stripe/server.ts`), Resend (`src/lib/email.ts:10` — sends recipient email + OTP), Cloudflare Turnstile (`src/lib/turnstile.ts:17`). No Trolley, no GoHighLevel, no Anthropic. Vercel region not pinned in-repo (no `vercel.json`/`vercel.ts`). **Someone has to write this down.** |
| A4 | No PII exported to non-system destinations | **DONE** | One export path only: `src/app/api/gc/export/route.ts`. GC-staff-gated (lines 12-15), exports **title metadata**, not personal data (`titles.catalog_id` + `title_metadata.data` + territory/rights from deliveries, lines 28-60), returns an `.xlsx` attachment, and records an append-only provenance snapshot via `record_export` before returning (lines 64-71). No email destination, no personal inbox, no ad-hoc dump. The only outbound email paths are the OTP and the GC-Support notification, both to addresses already in the system (`src/lib/email.ts:32,75`). |
| A5 | No plaintext credentials | **DONE** | Auth is fully delegated to Supabase Auth, and **magic-link only — there are no passwords in the product at all**: `supabase.auth.signInWithOtp` at `src/app/login/actions.ts:28-34`, with the design decision recorded at line 10. No password column, no hashing code, no `signInWithPassword` in `src/`. The only secrets stored are hashes: portal link/session tokens (`sha256`, `src/lib/portal.ts:23-25`) and OTP codes (`sha256(linkId:code)`, line 31-33). |
| A6 | Data deletion / account closure path | **MISSING** | No deletion or closure path exists. `org_status` has a `closed` value (`20260717000100_…:43-44`) and the dashboard renders a label for it (`src/app/(app)/page.tsx:26`), but **nothing ever sets it** — no RPC, no action, no route. No `auth.admin.deleteUser` call anywhere. The FK groundwork for doing it safely *is* in place and is the right shape: `memberships.user_id` is `on delete restrict` with the reasoning at `20260716000100_…:77-79` ("user deletion is a deliberate PII flow that must handle memberships explicitly, never cascade"). So the trap CLAUDE.md warns about is avoided, but the path itself is unbuilt. |
| A7 | No tax IDs or bank account numbers persist | **DONE** | Schema-wide check of all 26 tables' columns: the only payout-related fields are `organizations.trolley_recipient_id`, `payout_status`, `tax_form_status`, `payout_display` (`20260716000100_…:63-75`), which is exactly the "opaque ID + status + masked display" shape rule 13 requires. No column matching SSN/EIN/routing/account-number/IBAN exists in `information_schema.columns` for schema `public`. No such value is logged: the only `console.error` calls carry route tags and `error.message` (18 sites, all reviewed). |

## B. Database and tenancy

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | RLS enabled on **every** table | **DONE** | Live: `select relname, relrowsecurity from pg_class … where relkind='r' and nspname='public'` → **26/26 tables `relrowsecurity = true`**, zero exceptions: `assets, audit_log, contract_assents, contract_terms, deliveries, export_records, findings, gc_staff, memberships, notification_reads, notifications, organizations, portal_access_events, portal_links, portal_otps, portal_sessions, rights_grants, screener_view_events, source_documents, source_records, subscriptions, title_metadata, title_reviews, titles, vendors, works`. And **zero tables have RLS on with no policy** (checked explicitly). Enabled in migration at `20260716000100_…:256-261` and per-table thereafter. Two caveats: (a) inventory reflects `20260721000200`, see Environment Caveat 1; (b) no table sets `FORCE ROW LEVEL SECURITY`, so the table owner (`postgres`) bypasses RLS — intended and documented as the break-glass path at `20260716000100_…:332-333`. |
| B2 | Policies for SELECT/INSERT/UPDATE/DELETE on each table | **DONE (by design — read the note)** | Live per-table policy inventory by command: 21 tables have **SELECT only**; `memberships` and `vendors` have SELECT+INSERT+UPDATE; `organizations` SELECT+UPDATE; `notification_reads`, `source_documents`, `source_records` SELECT+INSERT. **No table anywhere has a DELETE policy** — that is golden rule 2 ("nothing is ever deleted") enforced structurally, and it is correct rather than a gap. Writes deliberately have no policy because they go through 33 `SECURITY DEFINER` functions; RLS default-deny then blocks the direct path. My live test confirms the intent holds rather than merely being asserted: e.g. `titles` grants `authenticated` INSERT/UPDATE/DELETE but has only a SELECT policy, and all four direct-write attempts against it returned `42501` or `0 rows affected` (W1-W4). |
| B3 | **Cross-org isolation proven by negative test** | **DONE** | See the priority section above. 110 cross-tenant attempts, 0 breaches; harness at `scripts/security/b3-cross-org-isolation.mjs`; output at sections 1, 1b, 2, 3. |
| B4 | Role escalation blocked | **PARTIAL** | **Writes: fully blocked.** As `viewer`, all of these were rejected — self-promotion to `account_owner` (`0 rows`, re-read confirms role unchanged), inviting a user (`42501`), `UPDATE organizations` (`0 rows`), `UPDATE organizations.trolley_recipient_id` (`0 rows`), `rpc accept_terms` (`P0001 Only the account owner can accept the agreement`), `rpc create_title` / `create_asset` / `add_rights_grant` (`P0001 Not authorized … for this organization`). The mechanism is `memberships_update`/`memberships_insert` requiring `manage_team`, which resolves to `account_owner` alone (`20260716000100_…:283-289`, `180-182`). **Reads: `viewer` sees billing.** Three live leaks, all within the viewer's own org: `SELECT subscriptions` returned the row incl. `tier`, `stripe_customer_id`, `stripe_subscription_id`, `annual_price_cents` (E9); `SELECT contract_terms` returned the row incl. `revenue_share_rate_bp` (E10); `SELECT organizations` exposed `trolley_recipient_id`/`payout_status`/`payout_display` (E11 — currently `null`, so the columns are readable but not yet populated). Cause: all three policies use `member_can(…, 'view')`, and `'view'` admits all five roles (`20260716000100_…:177`). CLAUDE.md scopes `viewer` to "catalog read-only", so this exceeds the spec. `accountant` and `legal` reading these is correct ("read all"). See Finding 2. |
| B5 | `gc_*` roles not self-assignable from a client session | **DONE** | Three defences, all live-tested. (1) `gc_staff` has a **SELECT policy only** (`is_gc_staff(auth.uid())`, `20260716000100_…:294-296`), so all three self-assign attempts — as `account_owner`, as `viewer`, as a user with no org — returned `42501 new row violates row-level security policy for table "gc_staff"`, and a service-role re-read confirmed no row was created. (2) Promoting or hijacking an *existing* staff row: `0 rows affected`, re-read confirms unchanged. (3) The `org_role` enum contains no `gc_*` value, so smuggling one into `memberships` is rejected by the type system at `22P02` before any policy evaluates — the collision surface is closed by the type, exactly as `20260716000100_…:35-47` claims. |
| B6 | Service-role key unreachable from a client bundle or a client-invokable edge path | **PARTIAL** | See the priority section above. Bundle: clean and build-verified. Edge paths: six of seven admin-client call sites sit on unauthenticated public routes, each individually gated. |
| B7 | Server-side validation on every write path | **DONE** | Two layers, and the load-bearing one is the DB. All 9 API routes that mutate parse with a zod schema before touching auth or the DB (`initiate:8-18`, `sign-parts:8-17`, `complete:8-21`, `request-otp:8-18`, `verify-otp:6-14`, `screener-event:7-15`, `asset-url:8`, `screener-url`, `vendors/actions.ts`). The 12 `"use server"` action files mostly pass straight through to an RPC, and that is fine because **every RPC re-validates server-side in SQL** — `auth.uid() is null` → raise, `member_can` → raise, title↔org → raise, plus domain checks (`create_title` requires non-empty title, a release type, and an `active` org; `submit_title` re-checks all six required metadata fields). Nothing trusts the form. One gap worth noting: `api/gc/export/route.ts:17` casts the body with `as` instead of zod, though it is GC-only and the IDs land in parameterised `.in()` filters. |
| B8 | Length/type/enum limits at the DB level too | **PARTIAL** | Type and enum limits: strong. 24 enum types carry the domain vocabulary (`org_role`, `title_status`, `rights_type`, `delivery_status`, `asset_kind`, …), all PKs are `uuid`, all timestamps `timestamptz`, money is `integer` cents. Six real CHECK constraints, and they encode business rules rather than shapes: `deliveries_territory_iso_chk` (`territory ~ '^[A-Z]{2}$'` — rule 12's "resolved ISO codes, never labels", enforced in the DB as required), `rights_grants_world_empty_chk`, `rights_grants_window_chk`, `portal_links_purpose_shape`, `vendors_email_recipients_chk`, `assets_bytes_check`. Eight UNIQUE constraints incl. `subscriptions_stripe_subscription_id_key` (which is what makes G4 work). **Missing: length limits.** `select … where character_maximum_length is not null` returns **zero rows** — every text column is unbounded `text`. Length caps exist only in zod at the edge (`filename ≤ 255`, `email ≤ 320`, `token ≤ 512`), so any write path that bypasses a zod-guarded route — an RPC called directly, e.g. `create_title(p_org_id, <10 MB string>, …)` — has no DB backstop. |
| B9 | Error responses generic to the client | **PARTIAL** | API routes are disciplined: they log detail server-side and return a generic message — `console.error('[assets:initiate] …')` then `"Could not start upload. Please try again."` (`initiate:35-36`), same shape in `complete:43-44`, `sign-parts:41-42`, `asset-url:45-46`, `checkout:67-68`, `webhook:22-23`. Server actions are not: **21 sites return `error.message` straight from PostgREST/Postgres to the client** (`(app)/titles/[id]/actions.ts:49,72,100,119`, `(app)/titles/actions.ts:31`, `(app)/messages/actions.ts:18`, `(app)/titles/[id]/metadata/actions.ts:30`, `app/actions.ts:18`, `login/actions.ts:36`, `agreement/actions.ts:37`, the eight `(operator)/gc/*` action sites, `vendors/actions.ts:78`; plus `api/assets/complete/route.ts:57`). Mostly that is deliberate and good UX — the RPCs raise authored messages like *"Cannot submit: required metadata field \"synopsis\" is missing"*. But the same channel passes through raw DB text on unexpected failures: my harness collected `42501 permission denied for table contract_assents` and `new row violates row-level security policy for table "gc_staff"` — table names and policy internals. |
| B10 | Stack traces suppressed in production | **UNVERIFIED-NEEDS-RUNTIME** | Structurally: `next build` succeeded and Next.js suppresses server error detail in production by default (digest only), and no route returns `e.stack`. But there is **no `error.tsx` or `global-error.tsx` anywhere in `src/app`** — so unhandled render errors fall to the framework default rather than a designed boundary, and there is no logger configuration in-repo (16 bare `console.error` calls; nothing redacts). **To check:** trigger a server error against a production deployment and confirm the response body carries only a digest. |
| B11 | Clickwrap acceptance audit trail append-only | **PARTIAL** | The UPDATE/DELETE half is enforced at the permission level, not by policy absence, and I confirmed it live: `revoke update, delete on public.contract_assents from authenticated, service_role` (`20260717000100_…:151`) — my attempts returned `42501 permission denied for table contract_assents` and a service-role re-read confirmed `terms_version` intact. Forging another org's assent returned `42501 violates RLS policy`. Live grants confirm `contract_assents` has INSERT+SELECT for `authenticated` and no DELETE/UPDATE. The row also carries what legal evidence needs: `terms_version`, `content_hash` of the rendered text, `source_document_id`, `agreed_at`, `ip`, `user_agent` (`20260717000100_…:85-96`), with the rendered text itself stored immutably. **The PARTIAL is Finding 1 below — `TRUNCATE` is still granted on this table, and `TRUNCATE` is not subject to RLS.** Also note A2: an append-only record of a placeholder agreement is not yet useful evidence. |

## C. Auth failure cases

Magic-link-only auth changes the shape of this section: four rows become N/A because there is no
password and no password reset.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| C1 | Wrong password five times | **N/A** | No passwords exist. `src/app/login/actions.ts:10` — "Magic-link only (domain-spec §21 decision): no passwords, no OAuth"; the only call is `signInWithOtp` (line 28). Nothing to throttle or lock. The analogous surface is magic-link *send* volume — see E2. |
| C2 | Password reset for an unknown address | **N/A** | No password reset flow exists (no `resetPasswordForEmail` in `src/`). |
| C3 | Email verification link clicked twice | **OUT-OF-REPO** | `src/app/auth/callback/route.ts` exchanges the code; the single-use semantics are Supabase Auth's, not this repo's. **To check by hand:** click a magic link twice against staging, confirm the second click lands somewhere graceful and not a 500. |
| C4 | Signup with an already-registered address | **DONE (by construction)** | `signInWithOtp({ email, shouldCreateUser: true })` returns the same result whether or not the account exists, and the UI shows one fixed string — `"Check your email for a secure sign-in link."` (`src/app/login/actions.ts:32,37`). There is no separate signup form to disclose from. One caveat: line 36 returns `error.message` verbatim if Supabase errors, so a future Supabase error string is a disclosure channel (see B9). |
| C5 | Org invite accepted twice → idempotent | **N/A-NOT-BUILT** | No invite system. Invitations are explicitly deferred at `20260716000100_…:21`. Membership is created by direct `INSERT` under the `manage_team` policy — no token, no acceptance step. The DB *is* pre-armed for idempotency: `unique (org_id, user_id)` on `memberships` (`20260716000100_…:88`, confirmed live as `memberships_org_id_user_id_key`), so a duplicate row is impossible whenever invites are built. |
| C6 | Expired/revoked invite token single-use | **N/A-NOT-BUILT** | Same. Worth noting the pattern to copy already exists and is good: the portal's OTP flow does hash-at-rest, expiry, an attempt cap, and single-use via `consumed_at` (`api/portal/verify-otp/route.ts:29-60`). |
| C7 | Invite token replayed against a different org | **N/A-NOT-BUILT** | Same. |
| C8 | Session behaviour after role change or removal | **DONE**, live-tested | Tested with the **same unexpired JWT** throughout, changing only the membership row. Removal: the viewer read 2 titles, then `status='removed'` was set as service_role, and the very next query returned **0 rows** — "access revoked on the next query, no re-login, no token refresh". Role change: after `viewer → delivery_ops`, `rpc create_title` succeeded immediately on the same token. This is the correct property and it follows from the architecture — authorization reads the `memberships` row inside `member_can()` on every statement, and nothing is cached in the JWT. Harness section 5 (C8a, C8b). |
| C9 | Last `account_owner` cannot remove/demote themselves | **MISSING** | **Live-reproduced.** The sole `account_owner` of Org A demoted themselves to `viewer` and it succeeded; a service-role count then returned **zero active `account_owner`s** for that org. The org is now unrecoverable from the client side: `accept_terms` requires `account_owner` (`20260717000100_…:181-187`), so are `manage_billing`, `manage_team`, and `manage_settings` (`20260716000100_…:180-182`). Nobody can pay, change tier, or invite anyone back. `memberships_update` checks only `manage_team` — there is no last-owner guard and no `status='removed'` equivalent guard (`20260716000100_…:286-289`). See Finding 3. |
| C10 | MFA for `account_owner` and `gc_staff` | **MISSING** | No MFA anywhere: `grep -rin 'mfa\|totp\|enroll' src/` returns only false positives on the portal's `requestOtp` function. Nothing calls `supabase.auth.mfa.*`. Note the current posture: single-factor email possession, and `gc_staff` is the role that spans **every** org (`member_can` returns `true` for all orgs when `is_gc_staff`, `20260716000100_…:170`). A compromised staff mailbox is a whole-tenant compromise. **Also to check in the Supabase dashboard:** whether MFA is enabled at the project level. |

## D. Secrets and keys

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| D1 | No secret keys in any client bundle | **DONE** | Ran a fresh `pnpm build`, then `grep -rl -a -E 'sk_(live|test)_|whsec_|AKIA[0-9A-Z]{16}|SUPABASE_SERVICE_ROLE|BEGIN (RSA )?PRIVATE KEY|CLOUDFRONT_PRIVATE_KEY|RESEND_API_KEY|TURNSTILE_SECRET'` over `.next/static` → **no matches**; a separate grep for the literal `service_role` → **no matches**. Structurally reinforced: `import "server-only"` guards `admin.ts:1`, `stripe/server.ts:1`, `s3.ts:1`, `cloudfront.ts:1`, `email.ts:1`, `turnstile.ts:1`, `agreements.ts:1`, `artwork.ts:1`. |
| D2 | `NEXT_PUBLIC_*` genuinely public | **DONE** | Exactly four, all legitimately public: `NEXT_PUBLIC_SUPABASE_URL` (project endpoint), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (designed for browsers; RLS is the boundary, and B3 proves it holds), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_`, publishable by definition), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (site key is rendered in the widget; the secret half is server-only at `turnstile.ts:9`). No fifth. |
| D3 | No secrets in git history | **DONE** | Full-history scan, not just HEAD: enumerated every reachable blob across all 233 commits (`git rev-list --objects --all` → `cat-file --batch`) and grepped the contents for `sk_live_/sk_test_`, `sk-ant-`, `AKIA[0-9A-Z]{16}`, `rk_live_`, `whsec_`, and `BEGIN PRIVATE KEY`. One hit, traced to blob `f18b504` = `docs/port-inventory.md` — the checklist row that *names* those patterns as things to look for. **No real secret has ever been committed.** `git log --all --diff-filter=A -- '.env*'` shows only `.env.example`. |
| D4 | `.env*` gitignored; `.env.example` has no real values | **PARTIAL** | Gitignore is correct and correctly scoped: `.env`, `.env.*`, `!.env.example` (`.gitignore:3-5`), and history confirms only `.env.example` was ever added. **I could not read `.env.example` to verify its contents** — it is blocked by this session's permission settings (`File is in a directory that is denied by your permission settings`), which is the right default for a Tier-3 repo. **To check by hand:** open `.env.example` and confirm every value is a placeholder. |
| D5 | API responses return only needed fields | **DONE** | **Zero occurrences of `select("*")` in `src/`.** Every read names its columns, and the narrow ones are notably tight: `assets → select('storage_key')` (`api/gc/asset-url/route.ts:32`), `gc_staff → select('user_id')` (line 24), `titles → select('org_id')` (`lib/assets.ts:34`), `assets → select('title_id, kind, storage_key, created_at')` (`lib/artwork.ts:23`). API routes return computed values, not rows: `{ uploadId, key, partSize }`, `{ urls }`, `{ url }`, `{ assetId }`, `{ received: true }`. |
| D6 | Secrets never written to logs | **DONE** | All 16 `console.error` sites reviewed. Each logs a bracketed route tag plus `error.message` — e.g. `[stripe:webhook] invalid signature: …`, `[assets:sign-parts] …`, `[turnstile] verify failed: …`. **No call logs a request body, a header, a cookie, a token, or an env value.** The two places handling secret material log nothing about it: `verify-otp` never logs the code or hash, and `cloudfront.ts` throws `Missing env ${name}` — the name, never the value (line 7). |
| D7 | SDK clients lazy-initialized inside functions | **PARTIAL** | Correct for the three that matter: **Stripe** is lazy behind a `Proxy` with the reason documented — the constructor throws on an empty key and pages importing it are evaluated at build time (`src/lib/stripe/server.ts:10-28`); **Supabase admin** constructs per call (`admin.ts:9-15`); **Resend** constructs inside each send (`email.ts:36,66`); **CloudFront** reads all three env vars inside `signAssetUrl` (`cloudfront.ts:12-16`). **The exception is S3:** `const s3 = new S3Client({ region })` at module scope (`src/lib/s3.ts:16`), with `AWS_REGION`/`S3_BUCKET` also read at module load (lines 14-15) using `!`. Any module importing `s3.ts` constructs the client at import time. Lower-risk than Stripe (the AWS SDK does not throw on missing credentials), but it is the one violation of the house rule. No Anthropic or Trolley client exists yet. |
| D8 | Key rotation procedure written down | **MISSING** | No rotation runbook. `docs/infra/` has `asset-storage-setup.md`, `asset-portal-setup.md`, `portal-go-live-checklist.md`, `portal-go-live-runbook.md` — all provisioning, none rotation. Notably absent for the two hardest cases: the **CloudFront key pair** (`CLOUDFRONT_KEY_PAIR_ID` + `CLOUDFRONT_PRIVATE_KEY`, `cloudfront.ts:14-15`) where rotating without a two-key-group overlap 403s every in-flight signed URL, and the **Supabase service-role key**, which is what the six portal routes and the Stripe webhook depend on. Given 8 secrets in play (Supabase service-role, Stripe secret, Stripe webhook, AWS access key pair, CloudFront key pair, Resend, Turnstile secret), this is a real gap for a Tier-3 launch. |

## E. Infrastructure and spend

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| E1 | Rate limits on every endpoint calling a paid API | **PARTIAL** | `grep -rin 'ratelimit\|rate_limit\|throttle\|upstash' src/` → **no matches**. There is no general rate-limiting layer. The one endpoint that does have limits has good ones: `/api/portal/request-otp` enforces a rolling-1h cap of 5 per (link,email) and 20 per link, counted from `portal_otps` (`api/portal/request-otp/route.ts:41-58`, constants at `lib/portal.ts:14-16`) — that covers Resend spend on the OTP path. **Unlimited for an authenticated caller:** `/api/stripe/checkout` (creates a Stripe session per call), `/api/assets/initiate` (a `CreateMultipartUpload` per call), `/api/assets/sign-parts` (**up to 1000 presigns per request**, `sign-parts:12`), `/api/gc/asset-url` and `/api/gc/screener-url` (an S3 `HEAD` and potentially a **Glacier restore** per call — `resolveOrRestore` auto-initiates, `s3.ts:113-121`), `/api/gc/export` (an `exceljs` build over N titles). No Anthropic or MediaConvert calls exist yet. |
| E2 | Rate limits on auth endpoints specifically | **PARTIAL / OUT-OF-REPO** | Nothing in-repo. Turnstile gates the magic-link send (`login/actions.ts:21`) and the OTP request (`request-otp:25`), which raises the cost of automation but is not a rate limit. Login/signup throttling therefore rests entirely on Supabase Auth's built-in email rate limits. **To check in the Supabase dashboard:** Auth → Rate Limits for this project (default is 2 emails/hour on the shared SMTP; if a custom SMTP is configured the limit is whatever was set). |
| E3 | Turnstile on every public form | **DONE** | There are exactly two unauthenticated forms and both are gated. `/login` renders `<Turnstile>` (`login/page.tsx:4`) and posts `cf-turnstile-response` (`login/actions.ts:17`). The portal identity form renders `<Turnstile>` with a `ref` for reset (`portal/[token]/portal-flow.tsx:4,144`) and sends `turnstileToken` (line 51). Every other form is behind the session gate. Nice detail: the client resets the widget on any failure because the token is single-use once redeemed (`portal-flow.tsx:55-58`). |
| E4 | Turnstile verified server-side | **DONE** | `verifyTurnstile` POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the server-only `TURNSTILE_SECRET_KEY` and returns `data.success === true` (`src/lib/turnstile.ts:6-30`). It **fails closed** on a missing token (line 7), a missing secret (lines 9-13), and a network throw (lines 26-29). Both call sites check it **before** any side effect: `login/actions.ts:21-23` before `signInWithOtp`; `request-otp/route.ts:25-27` before any DB work — with the ordering deliberate and commented (lines 23-24). |
| E5 | CORS restricted to production domains plus localhost | **DONE (two layers)** | App: no CORS headers are set anywhere (`grep 'Access-Control' src/ next.config.ts` → none), so browsers enforce same-origin on every route by default — nothing is opened. S3, verified live: prod bucket CORS allows `PUT, GET` from **`https://app.globalcontent.co` and `http://localhost:3000` only**; dev bucket from `http://localhost:3000` only. `AllowedHeaders` is a 3-item allowlist, not `*`. This is exactly the row's requirement, and it matters because direct-to-S3 multipart upload depends on it. |
| E6 | Security headers present | **MISSING** | None of the six. `next.config.ts` is 10 lines with only `allowedDevOrigins` and no `headers()` function; `src/middleware.ts` only calls `updateSession` and sets no headers; no `vercel.json`/`vercel.ts` exists. So no CSP, no HSTS, no `X-Content-Type-Options`, no `X-Frame-Options`, no `Referrer-Policy`, no `Permissions-Policy`. Worth weighting for this product specifically: the screener room renders a `<video>` from a signed CloudFront URL inside a page reachable by an unauthenticated recipient (`portal/[token]/screener-room.tsx:86`), and with no `X-Frame-Options`/`frame-ancestors` that page can be framed, and no `Referrer-Policy` means the signed URL's path can leak via `Referer` on any outbound navigation. |
| E7 | CSP does not rely on `unsafe-inline`/`unsafe-eval` | **N/A** | Vacuously — there is no CSP at all (E6). When one is added, note that Next.js App Router needs a nonce-based script policy, and Stripe Payment Element (`@stripe/react-stripe-js`, mounted at `agreement/pay/payment-checkout.tsx`) plus the Turnstile widget both require `frame-src`/`script-src` allowances for `js.stripe.com` and `challenges.cloudflare.com`. |
| E8 | Rate limits on media upload initiation | **MISSING** | `/api/assets/initiate` and `/api/assets/sign-parts` have no limit of any kind. An authenticated `account_owner`/`delivery_ops` can loop `initiate` to create unbounded multipart uploads (each is billable storage until aborted, and **no lifecycle rule exists to abort incomplete multipart uploads** — `get-bucket-lifecycle-configuration` on the prod bucket returns `NoSuchLifecycleConfiguration`), and each `sign-parts` call mints up to 1000 presigned URLs (`sign-parts:12`). `PART_SIZE` is 64 MiB (`lib/assets.ts:4`), so 1000 parts = 64 GiB of signed write capacity per request. Authorization is correct throughout; volume is simply unbounded. |
| E9 | Transcode/QC concurrency capped per org | **N/A-NOT-BUILT** | GC never transcodes — clients deliver platform-ready, and transcoding is explicitly deferred in CLAUDE.md. No MediaConvert, Rekognition, or Quasar code exists. The nearest live analogue is Glacier restore, which is uncapped: `/api/gc/asset-url` and both portal routes call `resolveOrRestore`, which auto-initiates a Standard restore on first hit (`s3.ts:113-121`). Billable, though currently unreachable in practice — see the lifecycle note in Finding 5. |

## F. Media asset security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F1 | No S3 bucket publicly readable | **DONE** | Verified live — see the priority section. |
| F2 | All media via CloudFront signed URLs/cookies | **DONE** | Verified live (`TrustedKeyGroups.Enabled: true`, OAC-only bucket policy) — see the priority section. |
| F3 | Signed URL TTLs short and scoped to one asset | **DONE** | Per-object canned policy; 300 s download / 6 h stream — see the priority section. |
| F4 | Presigned upload URLs scoped to one key under the caller's org prefix | **DONE** (runtime part untested) | See the priority section. |
| F5 | Asset paths not guessable across orgs | **DONE** | UUID-only path segments plus a per-upload random UUID — see the priority section. |
| F6 | Screener/preview access authorization-checked at request time | **DONE** | This is the strongest row in the audit — it is emphatically not "unlisted URL". Every screener frame re-runs `portal_resolve_screener(session_token_hash)` (`api/portal/screener/route.ts:12`), which requires a live unrevoked session, then a live unrevoked link with `purpose='screener_view'`, then resolves the key from the title's `screener_source` — raising if any step fails. The master-download path is stricter still: `portal_resolve_download` additionally requires the delivery status to be in a fail-closed allowlist (`pending/delivered/live` — so `rejected`/`taken_down` blocks) **and** re-checks rule 12 at request time, that the delivery's specific grant is still `effective_to is null`, in-window, and covers the territory. A grant that lapses revokes an already-issued portal link on its next use. Session cookie is `httpOnly`, `sameSite=lax`, `secure` in production (`verify-otp:84-90`). GC's internal viewer re-checks `gc_staff` per request (`api/gc/asset-url/route.ts:23-28`). And the download is fail-closed on provenance: if the `portal_access_events` insert fails, the route returns 500 and the client never receives the URL (`download/route.ts:54-60`). |
| F7 | Glacier lifecycle transitions do not silently break access control | **DONE (code)** — but see caveat | Authorization always precedes the restore decision. In both portal routes, `portal_resolve_*` runs first and only then `resolveOrRestore` (`download/route.ts:14-24`, `screener/route.ts:12-19`); in the GC route, the `gc_staff` check precedes it (`asset-url:23-39`). An archived object returns 409 "preparing" rather than a broken URL, and `parseRestore` maps S3's `StorageClass` + `x-amz-restore` header with `GLACIER`/`DEEP_ARCHIVE` → `none`/`restoring` (`s3.ts:76-86`, unit-tested in `s3.test.ts`). `initiateRestore` swallows `RestoreAlreadyInProgress` so it is idempotent (lines 95-109). **Caveat:** the restore path has never actually run, because **the lifecycle rule that would tier masters to Glacier does not exist** — `aws s3api get-bucket-lifecycle-configuration --bucket gc-content-assets-prod` returns `NoSuchLifecycleConfiguration`. See Finding 5. |
| F8 | QC records do not embed signed URLs outliving their TTL | **N/A-NOT-BUILT** | No QC subsystem exists (the matrix's own "Open items" says the schema is undefined). I checked the adjacent risk instead — whether any signed URL is *persisted* anywhere — and it is not: all four `signAssetUrl` call sites mint on demand and return in the HTTP response (`portal/screener:41`, `portal/download:45`, `gc/asset-url:43`, `gc/screener-url:59`), and `lib/artwork.ts:33` builds them into a per-request in-memory `Map`. Rule 14 holds throughout: the DB stores `storage_key`, never a URL — `grep 'storage_key' src/**/*.tsx` → 0 hits, so keys do not even reach client components. |

## G. Payments, payouts and webhooks

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| G1 | Stripe webhook signature verified before processing | **DONE** | See the priority section. |
| G2 | Trolley webhook signature verified | **N/A-NOT-BUILT** | See the priority section. |
| G3 | GoHighLevel outbound-only; no inbound path | **DONE** | See the priority section. |
| G4 | Webhook handlers idempotent | **DONE** | See the priority section. |
| G5 | Raw webhook body preserved | **DONE** | See the priority section. |
| G6 | Subscription state derived from Stripe, not client-supplied tier | **DONE** | The client asserts nothing about tier or price at any point. `/api/stripe/checkout` takes **no request body at all** (`export async function POST()`, line 11). It derives the org from the caller's own `account_owner` membership and requires `status === 'awaiting_payment'` (lines 18-27); reads the tier from the **accepted agreement source document** (`source_documents.raw->>'tier'`, lines 30-41, narrowed to `pro|premium`); and takes the price from the server-side `TIER_META` constant, not the request (line 57). The webhook then reads tier from `session.metadata`, which only this route wrote, and the term length is recomputed in SQL (`case when p_tier='premium' then 24 else 12`, `20260717000100_…:230`). `effective_from` is the Stripe **event** timestamp, never `now()` (`webhook/route.ts:40`) — golden rule 8 satisfied. Live-tested: `authenticated` cannot write `subscriptions` or `contract_terms` directly (`42501` on INSERT, `0 rows` on UPDATE with re-read confirming unchanged), and `finalize_paid_signup` is `42501 permission denied for function`. |
| G7 | Tier entitlements enforced server-side | **PARTIAL** | The one entitlement gate that exists is enforced in the database, correctly: `create_title` raises `'Your organization must finish onboarding before adding titles'` unless `organizations.status = 'active'` (`20260721000100_gate_title_creation_active_org.sql`, visible in the live function body). That is server-side and unbypassable from the client. But **no per-tier entitlement differences are implemented at all** — nothing anywhere reads `contract_terms.tier` or `subscriptions.tier` to gate a capability, so there is no Access-vs-Pro-vs-Premium distinction to enforce yet. Rule 11 ("a tier change gates future actions … enforce at the point of action") therefore has exactly one point of action built. Not a hole today; it becomes one the moment a tier-differentiated feature ships. |
| G8 | Fees cannot be triggered or waived by a client role | **N/A-NOT-BUILT** | No fees table, no fee-charging path, no takedown flow. `grep -rin 'early_takedown\|rights_change' supabase/migrations/` returns a single comment at `20260718000200_rights_grants.sql:20` describing them as future work. `title_status` has `takedown_requested`/`taken_down` values but nothing transitions into them. Blocked as the matrix's own "Open items" notes (three revenue-share rates unfinalized; `contract_terms.revenue_share_rate_bp` is a hardcoded `0` placeholder at `20260717000100_…:177,231`). |
| G9 | Referral accrual job not client-invocable | **N/A-NOT-BUILT** | No referral system: `grep -rin 'referral\|accrual' src/ supabase/migrations/` → **zero matches**. No cron or scheduled job exists either (no `pg_cron`, no Vercel cron config, no `vercel.json`). Note for when it is built: rule 8's lapse job is also unbuilt, and it is the one that must be idempotent. |
| G10 | Referral attribution immutable after signup | **N/A-NOT-BUILT** | Same — no referral column or table exists to constrain. |

## H. Final gate

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| H1 | Claude Security plugin scan, zero HIGH outstanding | **NOT-RUN** | The `claude-security` plugin is not installed in this session (available skills do not include it). It needs `/plugin install claude-security@claude-plugins-official`, `/reload-plugins`, then `/claude-security`, which is an interactive install I did not perform unasked. **This audit is not a substitute for it** — it is a different method (manual + live testing) and would miss classes of thing a static taint analysis catches. |
| H2 | Dependency vulnerabilities resolved | **MISSING** | `pnpm audit`: **15 vulnerabilities — 8 high, 7 moderate**, none documented as an accepted exception. The important one for this app: **`next` 16.2.9 needs ≥ 16.2.11**, and one of the advisories is *"Next.js: Middleware / Proxy bypass in App Router applications"* — this app's entire authentication gate is middleware (`src/middleware.ts` → `updateSession`), so a middleware-bypass advisory is directly load-bearing here. The same bump also fixes SSRF in Server Actions, SSRF via rewrites, DoS in Server Actions, response-body cache confusion, and unauthenticated disclosure of internal Server Function endpoints. Also high: `postcss` (→ ≥ 8.5.18, arbitrary file read + path traversal), `sharp`/libvips (→ ≥ 0.35.0, CVE-2026-33327), `brace-expansion` (→ ≥ 5.0.8). All are dependency bumps, not code changes. See Finding 4. |
| H3 | Typecheck and build pass with no suppressed errors | **DONE** | `pnpm build` succeeds. `pnpm typecheck` (`tsc --noEmit`) is **clean, zero errors**, under `"strict": true` (`tsconfig.json:7`). Worth recording because it did not start clean: the first run failed with 9 × `TS2307 Cannot find module '../../src/app/gc/…'` from a **stale generated `.next/types/validator.ts`** left over from the `(operator)` route-group refactor; it passes after a fresh build, so the errors are a build-artifact artefact and not real. Suppressions: **no `@ts-ignore` and no `@ts-expect-error` anywhere.** Three `eslint-disable-next-line` comments, all narrow and justified — two `@next/next/no-img-element` for signed CloudFront URLs that must not go through `next/image` (`components/layout/artwork.tsx:22`, `spotlight-banner.tsx:32`) and one `react-hooks/exhaustive-deps` (`search-field.tsx:27`). `pnpm test` also passes: 82 tests, 11 files. |
| H4 | Matrix re-run before each subsequent launch | **PROCESS** | This is the first run; the result is this file. Two things would make re-running cheap and are worth doing: (a) add `scripts/security/b3-cross-org-isolation.mjs` to CI, since B3 is the highest-value row and is now a single command; (b) add the existing pgTAP suite (`supabase/tests/*.sql`, 22 files including `rls_tenant_isolation_test.sql`) to CI — **none of it currently runs anywhere**, the only workflow being `migration-drift.yml`. |

## I. Not answerable from the repo

All ten need a console login. Recording what to check and any partial signal the repo gives.

| ID | Requirement | Status | Evidence / what to check |
|---|---|---|---|
| I1 | Anthropic hard monthly spend cap | **OUT-OF-REPO — and not yet needed** | Claude Console → Billing → Spend limits. Note there is **no Anthropic dependency in this repo** (`package.json` has no `@anthropic-ai/*`; AI findings and Ask Globee are deferred), so no spend can originate here yet. Set the cap before the first AI feature merges. |
| I2 | Email alert at ~50% of that cap | **OUT-OF-REPO** | Claude Console → Billing → Email notifications. Same timing note as I1. |
| I3 | AWS budget alarms for S3, CloudFront, MediaConvert | **OUT-OF-REPO** | AWS Billing → Budgets, account `469511672937`. Worth prioritising given E8: upload initiation is unlimited and there is no abort-incomplete-multipart lifecycle rule, so storage spend has no in-app ceiling. MediaConvert is not used. |
| I4 | Supabase spend cap / usage alerts per project | **OUT-OF-REPO** | Supabase dashboard for project `uevsculwzwlhxeamagwg` (ref from `.github/workflows/migration-drift.yml`), plus the other two projects. |
| I5 | Stripe webhook endpoint registered in **live** mode | **OUT-OF-REPO** | Stripe Dashboard → Developers → Webhooks, live mode. Check the endpoint URL is the production `/api/stripe/webhook`, that `checkout.session.completed` is subscribed (the only event the handler acts on, `webhook/route.ts:26`), and that the live signing secret is the `STRIPE_WEBHOOK_SECRET` in Vercel production. The repo notes the current slice is test-mode (`20260717000100_…:16`). |
| I6 | RLS confirmed enabled in the **production** project | **OUT-OF-REPO** | I verified 26/26 tables have RLS on in the **local** database only. Confirm the same in the prod project — and note Environment Caveat 1: prod may also be behind `main`, which is precisely what `migration-drift.yml` exists to catch. That workflow **no-ops silently** until `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` repo secrets are set; check whether they are. |
| I7 | Resend domain verified; sending limits understood | **OUT-OF-REPO** | Resend dashboard. Verify `globalcontent.co` and specifically the `assets@globalcontent.co` sender, which is the default `EMAIL_FROM` (`src/lib/email.ts:10`). Both the portal OTP and every GC-Support notification send from it, so an unverified domain silently breaks asset delivery. |
| I8 | Cloudflare WAF active on production hostnames | **OUT-OF-REPO** | Cloudflare dashboard. Relevant hostnames: `app.globalcontent.co` (from the S3 CORS allowlist) and `delivery.globalcontent.co` (the CloudFront alias). Given E1/E2/E8 have no in-app rate limiting, WAF rate-limiting rules are currently the only volumetric control — treat this as compensating, not optional. |
| I9 | Vercel env vars scoped correctly across preview/production | **OUT-OF-REPO** | Vercel → team E8 Holdings → project → Settings → Environment Variables. Confirm the 8 server secrets are not exposed to Preview with production values: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFRONT_PRIVATE_KEY`, `CLOUDFRONT_KEY_PAIR_ID`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`. |
| I10 | Preview deployments not publicly reachable with production data | **OUT-OF-REPO — check this one first** | Vercel → Settings → Deployment Protection. This interacts badly with E6/B6: previews have **no security headers**, and `/api/portal/*` is exempt from the auth gate by design (`middleware.ts:36-43`), so an unprotected preview pointed at the production Supabase project would expose service-role-backed portal routes on an unlisted-but-public URL. |

---

# Findings, worst first

## 1. `TRUNCATE` is granted to `authenticated` on all 26 tables, and `TRUNCATE` ignores RLS

**Affects B2, B11, golden rules 2/3/5.**

Live evidence — `information_schema.role_table_grants` for grantee `authenticated`:

```
audit_log         | INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
contract_assents  | INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
source_documents  | INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
…all 26 tables carry TRUNCATE, for both `authenticated` and `service_role`
```

`has_table_privilege('authenticated', 'audit_log', 'TRUNCATE')` → `true`.

PostgreSQL does not apply row-level security to `TRUNCATE` (it is not a row operation), so no policy
in this schema constrains it. The migrations carefully revoke the row verbs — `revoke update, delete
on public.audit_log from authenticated, service_role`
(`20260716000100_…:329-331`), the same for `source_documents`/`source_records`, and `revoke update,
delete on public.contract_assents` (`20260717000100_…:151`) — but **no migration revokes
`TRUNCATE` anywhere** (`grep -rin truncate supabase/migrations/` → no matches). The grant comes from
Supabase's platform default `GRANT ALL` on `public`, so it was inherited rather than chosen; note
that `anon` was correctly stripped of everything (`revoke all … from anon` in each migration) while
`authenticated` kept the residue.

**Scope it honestly: this is not remotely exploitable through the app today.** PostgREST has no
`TRUNCATE` verb, and a browser client holds a JWT to PostgREST, not a Postgres connection as the
`authenticated` role. I did **not** execute a truncation — it is destructive and the repo's
`guard-destructive.sh` hook blocks it, correctly. So this is a privilege-hygiene and
defence-in-depth defect, not an open door.

It still matters at Tier 3 for two reasons. It contradicts the stated control: rule 5 says
`audit_log` is append-only with "UPDATE/DELETE revoked **at the permission level**", and B11 asks
whether acceptance rows "cannot be updated or deleted by a client role" — a role that can empty the
table has not been denied that. And it becomes reachable the moment anything connects to Postgres
as `authenticated` (a direct/pooled connection, a `SECURITY INVOKER` function, a future job runner).
The fix is one revoke on `public`'s default privileges plus all existing tables — but it is a
permission change, so it needs your sign-off and its own migration.

## 2. `viewer` can read billing, the revenue-share rate, and payout fields

**Affects B4.** Live-reproduced as E9/E10/E11: a `viewer` in their own org read the full
`subscriptions` row (`tier`, `stripe_customer_id`, `stripe_subscription_id`, `annual_price_cents`),
the full `contract_terms` row (`revenue_share_rate_bp`, `expires_at`, `tier`), and
`organizations.trolley_recipient_id` / `payout_status` / `payout_display`.

Cause: all three policies gate on `member_can(auth.uid(), org_id, 'view')`, and `'view'` resolves to
all five roles including `viewer` (`20260716000100_…:177`; policies at `20260717000100_…:139-148`
and `20260716000100_…:270-271`). CLAUDE.md scopes `viewer` to "catalog read-only", so this exceeds
the role's definition. `accountant` and `legal` reading these is correct ("read all"). The payout
columns are `null` today, so nothing has actually leaked — but they are readable, and the
revenue-share rate and annual price are real commercial terms visible to the least-privileged role.

Wants a `'view_financial'` capability in `member_can` (owner/accountant/legal) with those three
policies switched to it. That is a policy change — your call, and it needs a migration.

## 3. The sole `account_owner` can orphan their own org

**Affects C9.** Live-reproduced: the only `account_owner` of Org A set their own role to `viewer`,
the update succeeded, and the org was left with **zero active `account_owner`s**. Nothing can
recover it from the client side — `accept_terms` (`20260717000100_…:181-187`), `manage_billing`,
`manage_team`, and `manage_settings` all require `account_owner`
(`20260716000100_…:180-182`). The org can no longer pay, change tier, or invite anyone back; it
needs GC staff or a service-role intervention.

`memberships_update` checks only `manage_team` and has no last-owner guard
(`20260716000100_…:286-289`); the same gap applies to setting the last owner's `status='removed'`
once a removal UI exists. My harness restores the fixture afterwards so it is re-runnable.

A trigger or an RPC-only membership write path that refuses the transition when it would leave zero
active `account_owner`s. Note this is currently reachable only by direct API call — no UI exposes
role editing yet — which is the window to fix it in.

## 4. 8 high-severity dependency advisories, including a middleware bypass in Next.js

**Affects H2.** `next` is pinned at `16.2.9`; the fix line is `≥ 16.2.11`. Among the advisories is
*"Next.js: Middleware / Proxy bypass in App Router applications"*. This app authenticates in
middleware — `src/middleware.ts` → `updateSession`, which is what redirects unauthenticated
requests to `/login` and what defines the `/api/portal/*` and webhook exemptions
(`src/lib/supabase/middleware.ts:36-43`). A middleware-bypass advisory therefore lands on the
component that gates every non-public route. The same bump also closes SSRF in Server Actions, SSRF
via rewrites, App Router DoS, response-body cache confusion, and unauthenticated disclosure of
internal Server Function endpoints. Additional highs: `postcss` → ≥ 8.5.18, `sharp`/libvips →
≥ 0.35.0, `brace-expansion` → ≥ 5.0.8.

Worth noting what does **not** save you here: RLS is unaffected by any of these, so a middleware
bypass does not become a cross-tenant read (B3 holds independently). It does expose routes that
assume "middleware already checked there is a session" — and the API routes do re-check
`supabase.auth.getUser()` themselves, which is why this is a bump-and-verify rather than an
emergency.

All four are version bumps, no code change expected. I have not touched `package.json`.

## 5. The Glacier lifecycle rule does not exist, so the `restoring` path has never run

**Affects F7, E8.** `aws s3api get-bucket-lifecycle-configuration --bucket gc-content-assets-prod`
returns `NoSuchLifecycleConfiguration`. CLAUDE.md specifies "Masters go to Glacier Flexible at 90
days (lifecycle policy, not code — masters only, not artwork/screeners)". The code half is built and
unit-tested (`s3.ts:76-121`, `parseRestore` covered in `s3.test.ts`, `restoring` state wired through
both portal routes and the GC viewer); the infrastructure half is absent.

Not a security hole — access control is not weakened, and F7 passes on the code path. But two
consequences: the entire restore/`restoring` code path is **dead in production and therefore
unexercised**, so its first real execution will be during a live vendor delivery; and there is no
`AbortIncompleteMultipartUpload` rule either, which is what makes E8's unlimited upload initiation a
real storage-spend exposure. Both are lifecycle configuration on the prod bucket.

---

## Summary of statuses

77 rows total.

| Status | Count | Rows |
|---|---|---|
| **DONE** | 31 | A4, A5, A7, B1, B2, B3, B5, B7, C4, C8, D1, D2, D3, D5, D6, E3, E4, E5, F1, F2, F3, F4, F5, F6, F7, G1, G3, G4, G5, G6, H3 |
| **PARTIAL** | 11 | A2, B4, B6, B8, B9, B11, D4, D7, E1, E2, G7 |
| **MISSING** | 8 | A3, A6, C9, C10, D8, E6, E8, H2 |
| **N/A** (no such surface exists in this product) | 3 | C1, C2, E7 |
| **N/A-NOT-BUILT** (deferred; seam noted) | 9 | C5, C6, C7, E9, F8, G2, G8, G9, G10 |
| **OUT-OF-REPO / needs a console or a running env** | 13 | A1, B10, C3, I1-I10 |
| **NOT-RUN** | 1 | H1 (Claude Security plugin not installed in this session) |
| **PROCESS** | 1 | H4 |

**The two highest-value rows both pass.** B3 (cross-org isolation) is proven by 110 live
cross-tenant attempts with zero breaches, and F1-F3 (no public bucket, OAC-only origin, signed URLs
actually enforced by a CloudFront trusted key group) are verified against the live AWS account
rather than inferred. G1-G5 are clean.

**What is not ready for a Tier-3 launch**, roughly in order: the dependency backlog (Finding 4, a
same-day bump); missing security headers (E6 — nothing at all, and the screener room is framable);
no rate limiting outside the OTP path (E1/E2/E8, with an unbounded upload surface and no abort
lifecycle); the three role/authorization defects (Findings 1-3, each needing a migration and your
approval); the placeholder agreement text making the whole clickwrap evidence chain provisional
(A2); and three absent-but-required documents/paths — data inventory (A3), account closure (A6), key
rotation (D8). Section I is untouched and needs someone in the consoles; **I10 first**, because an
unprotected preview pointed at production data would bypass most of what this audit verified.

## Reproducing

```bash
# B3 / B4 / B5 / B11 / C8 / C9 — needs a running local Supabase (`npx supabase status`)
node scripts/security/b3-cross-org-isolation.mjs        # exit 1 = at least one FAIL

# H2 / H3
pnpm audit && pnpm typecheck && pnpm test && pnpm build

# F1 / F2 / F3 — read-only, needs the `gc` AWS profile
AWS_PROFILE=gc aws s3api get-public-access-block --bucket gc-content-assets-prod
AWS_PROFILE=gc aws s3api get-bucket-policy --bucket gc-content-assets-prod
AWS_PROFILE=gc aws cloudfront get-distribution-config --id E2AGBND4FJRHBT \
  --query 'DistributionConfig.DefaultCacheBehavior.TrustedKeyGroups'
```

The harness leaves its fixtures in the local database, tagged with a per-run id, for inspection.
It creates users named `sec-<runtag>-{a-owner,a-viewer,b-owner,outsider,gc-staff}@example.test`.
