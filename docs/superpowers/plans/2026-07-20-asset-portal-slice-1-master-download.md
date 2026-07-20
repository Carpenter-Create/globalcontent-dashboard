# Asset-Access Portal — Slice 1 (Master Download) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an account-less, branded, OTP-gated, CloudFront-signed portal that lets a delivery recipient download a title's master, with every room-view / code-send / code-verify / download recorded.

**Architecture:** Four new tables (`portal_links`, `portal_otps`, `portal_sessions`, `portal_access_events`) + three SECURITY DEFINER RPCs, all in one migration. The account-less recipient hits a public `/portal/[token]` page (middleware-exempted) that drives three Next.js **route handlers** under `/api/portal/*`. Those handlers run server-side with the **service-role admin client** (the recipient has no JWT) and thin `server-only` libs for CloudFront signing and Resend email. All crypto (token/OTP generation, hashing, constant-time compare) lives in a pure, Vitest-tested `src/lib/portal.ts`; the crown-jewel authorization (session validity + rule-12 grant re-check + storage-key resolution) lives in the pgTAP-tested `portal_resolve_download` RPC. GC generates/revokes links from the existing `/gc/deliveries` surface.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), `@supabase/supabase-js`/`@supabase/ssr`, `@aws-sdk/cloudfront-signer` (new), `resend` (new), zod, Vitest + pgTAP. Package manager: **pnpm**.

## Global Constraints

Every task's requirements implicitly include these (verbatim from CLAUDE.md + the spec `docs/superpowers/specs/2026-07-20-asset-portal-slice-1-master-download-design.md`):

- **Package manager is pnpm** — never `npm install`. Add deps with `pnpm add`.
- **RLS is the authorization layer.** Every new table: `enable row level security`, `revoke all from anon`, a SELECT policy, and writes revoked from `authenticated`. First-migration golden rules apply.
- **Rule 14 — S3 keys in Postgres, never URLs.** Signed CloudFront URLs minted server-side on demand; the `storage_key` never leaves the server, only a short-lived signed URL does.
- **Rule 10 — anything cheatable lives server-side.** All gate logic (OTP issue/verify, session minting, grant re-check, URL signing) runs in route handlers / RPCs, never the client.
- **Rule 2 — nothing is ever deleted.** Link revocation is `revoked_at` (soft), never DELETE.
- **Rule 5 — append-only provenance.** `portal_access_events` has UPDATE/DELETE revoked from **everyone incl. `service_role`**.
- **Rule 12 — no delivery outside an active grant's window, enforced in the DB.** The download RPC re-checks the delivery's specific grant is active + in-window and fails closed.
- **Known Gotcha — optional RPC args must be `default null`** in SQL or generated TS types mark them required.
- **Bearer secrets are stored hashed** (link token, OTP code, session token) — raw values exist only in the URL / email / cookie.
- **Design: tokens only, neutral `--accent` placeholder** (`src/app/tokens.css`) — never hardcode hex; the real accent is a founder checkpoint. Copy lives in a `src/lib/*.ts` module, not inline JSX.
- **Voice (UI/email copy):** calm, declarative, no filler. **Banned words:** seamless, frictionless, white-glove, elevate, amplify, one-stop shop, best-in-class, etc. (see CLAUDE.md).
- **Destructive-ops approval gate:** the migration (tables + triggers + revokes) MUST be shown to the user and explicitly approved BEFORE it is applied (`supabase db reset`). This is a hard stop in Task 1.
- **Secrets are server-only**, never `NEXT_PUBLIC_`. Run `/leak-check` before shipping.
- New env vars (provisioned by the user in parallel; wire at implementation): `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`, `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`, `PORTAL_BASE_URL`.

---

## File Structure

**Create:**
- `supabase/migrations/20260720000100_portal_gate.sql` — 4 tables + enum + 3 RPCs + RLS/revokes/indexes.
- `supabase/tests/portal_test.sql` — pgTAP for RLS + all 3 RPCs.
- `src/lib/portal.ts` — pure crypto + constants + copy (Vitest-tested).
- `src/lib/portal.test.ts` — Vitest for `src/lib/portal.ts`.
- `src/lib/cloudfront.ts` — `server-only` CloudFront URL signer.
- `src/lib/cloudfront.test.ts` — Vitest (generates a throwaway RSA key to verify signing).
- `src/lib/email.ts` — `server-only` Resend wrapper + OTP email builder.
- `src/lib/email.test.ts` — Vitest for the pure email builder.
- `src/app/portal/layout.tsx` — branded public shell (outside app/gc shells).
- `src/app/portal/[token]/page.tsx` — server component: resolve link validity, render flow.
- `src/app/portal/[token]/portal-flow.tsx` — `"use client"` component: identity → code → download.
- `src/app/api/portal/request-otp/route.ts`
- `src/app/api/portal/verify-otp/route.ts`
- `src/app/api/portal/download/route.ts`
- `src/app/gc/deliveries/portal-links.tsx` — `"use client"` GC link manager (generate/copy/revoke + events).
- `docs/infra/asset-portal-setup.md` — CloudFront + Resend provisioning notes + env vars.

**Modify:**
- `src/lib/supabase/middleware.ts` — add `/portal` and `/api/portal` to the public whitelist.
- `src/app/gc/deliveries/actions.ts` — add `createPortalLink` + `revokePortalLink` server actions.
- `src/app/gc/deliveries/page.tsx` — load per-delivery links + access events; render `PortalLinks`.
- `src/lib/supabase/database.types.ts` — regenerated after the migration (not hand-edited).
- `package.json` — new deps (`pnpm add resend @aws-sdk/cloudfront-signer`).

---

## Task 1: Migration — portal gate schema + RPCs + pgTAP

**Files:**
- Create: `supabase/migrations/20260720000100_portal_gate.sql`
- Test: `supabase/tests/portal_test.sql`
- Modify (regenerate): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `public.deliveries(id, org_id, title_id, vendor_id, grant_id, territory)`, `public.assets(id, title_id, kind, storage_key)`, `public.rights_grants(id, title_id, rights_type, effective_to, window_start, window_end, territory_mode, territories)`, helpers `is_gc_staff(uuid)`.
- Produces:
  - `create_portal_link(p_delivery_id uuid, p_asset_id uuid, p_token_hash text, p_expires_at timestamptz default null) returns uuid`
  - `revoke_portal_link(p_link_id uuid) returns void`
  - `portal_resolve_download(p_session_token_hash text) returns table(storage_key text, link_id uuid, session_id uuid)`
  - Tables `portal_links`, `portal_otps`, `portal_sessions`, `portal_access_events`; enum `portal_event`.

- [ ] **Step 1: Write the pgTAP test first**

Create `supabase/tests/portal_test.sql`:

```sql
begin;
select plan(14);

-- ---- fixtures (as superuser / owner) --------------------------------------
select set_config('t.org',   gen_random_uuid()::text, false);
select set_config('t.gc',    gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);
select set_config('t.title', gen_random_uuid()::text, false);
select set_config('t.grant', gen_random_uuid()::text, false);
select set_config('t.asset', gen_random_uuid()::text, false);
select set_config('t.vendor',gen_random_uuid()::text, false);
select set_config('t.deliv', gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.gc')::uuid), (current_setting('t.owner')::uuid);
insert into public.organizations (id, name, status)
  values (current_setting('t.org')::uuid, 'Org A', 'active');
insert into public.memberships (user_id, org_id, org_role)
  values (current_setting('t.owner')::uuid, current_setting('t.org')::uuid, 'account_owner');
insert into public.gc_staff (user_id, gc_role)
  values (current_setting('t.gc')::uuid, 'gc_admin');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title')::uuid, current_setting('t.org')::uuid, 'Film', 'in_delivery');
insert into public.rights_grants (id, title_id, rights_type, territory_mode, territories, effective_from)
  values (current_setting('t.grant')::uuid, current_setting('t.title')::uuid, 'svod', 'world', '{}', now() - interval '1 day');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (current_setting('t.asset')::uuid, current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          'master', 'orgs/x/titles/y/master/z/film.mov', 'deadbeef', 1000);
insert into public.vendors (id, name, active) values (current_setting('t.vendor')::uuid, 'Vendor', true);
insert into public.deliveries (id, org_id, title_id, vendor_id, grant_id, territory, status)
  values (current_setting('t.deliv')::uuid, current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          current_setting('t.vendor')::uuid, current_setting('t.grant')::uuid, 'US', 'delivered');

-- ---- create_portal_link: GC-only ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_portal_link(%L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset'), 'hash_client'),
  'P0001', 'Not authorized', 'client cannot create a portal link');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_portal_link(%L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset'), 'hash_ok'),
  'GC creates a portal link');
select is((select count(*) from public.portal_links where token_hash = 'hash_ok')::int, 1,
  'exactly one link row for the token hash');

-- non-master asset rejected
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          'artwork', 'orgs/x/titles/y/artwork/z/art.jpg', 'beef', 10);
select throws_ok(
  format($$ select public.create_portal_link(%L, (select id from public.assets where kind='artwork'), %L) $$,
         current_setting('t.deliv'), 'hash_art'),
  'P0001', 'must be a master asset', 'non-master asset rejected');

-- ---- portal_resolve_download ----------------------------------------------
reset role;  -- fixture inserts into RPC-only / append-only tables run as owner
select set_config('t.link', (select id from public.portal_links where token_hash='hash_ok')::text, false);
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link')::uuid, 'sess_ok', 'Jo Buyer', 'Buyer Co',
          'jo@buyer.test', now() + interval '24 hours')
  returning set_config('t.sess', id::text, false);

select is(
  (select storage_key from public.portal_resolve_download('sess_ok')),
  'orgs/x/titles/y/master/z/film.mov',
  'valid session resolves to the master storage_key');

-- expired session rejected
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link')::uuid, 'sess_expired', 'A','B','a@b.test',
          now() - interval '1 hour');
select throws_ok($$ select public.portal_resolve_download('sess_expired') $$,
  'P0001', 'Session expired or not found', 'expired session rejected');

-- unknown session rejected
select throws_ok($$ select public.portal_resolve_download('nope') $$,
  'P0001', 'Session expired or not found', 'unknown session rejected');

-- revoked link rejected
update public.portal_links set revoked_at = now() where token_hash = 'hash_ok';
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'Link expired or revoked', 'revoked link rejected');
update public.portal_links set revoked_at = null where token_hash = 'hash_ok';

-- lapsed grant rejected (rule 12 re-check)
update public.rights_grants set effective_to = now() - interval '1 hour'
  where id = current_setting('t.grant')::uuid;
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'no longer covered by an active grant', 'lapsed grant fails closed');
update public.rights_grants set effective_to = null where id = current_setting('t.grant')::uuid;

-- ---- revoke_portal_link: GC-only ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.revoke_portal_link(%L) $$, current_setting('t.link')),
  'P0001', 'Not authorized', 'client cannot revoke a link');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(format($$ select public.revoke_portal_link(%L) $$, current_setting('t.link')),
  'GC revokes a link');
select isnt((select revoked_at from public.portal_links where id = current_setting('t.link')::uuid), null,
  'revoked_at is set (soft revoke, not deleted)');

-- ---- RLS: client cannot read portal tables --------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is((select count(*) from public.portal_links)::int, 0,
  'client SELECT on portal_links returns nothing (GC-only policy)');

-- ---- append-only: nobody can UPDATE portal_access_events ------------------
reset role;
insert into public.portal_access_events (link_id, event_type, email)
  values (current_setting('t.link')::uuid, 'room_viewed', 'jo@buyer.test');
set local role service_role;
select throws_ok(
  $$ update public.portal_access_events set email = 'x' where email = 'jo@buyer.test' $$,
  '42501', null, 'service_role cannot UPDATE append-only access events');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `portal_links` / `create_portal_link` / etc. do not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260720000100_portal_gate.sql`:

```sql
-- ============================================================================
-- 20260720000100_portal_gate.sql
--
-- INTENT: the asset-access portal GATE (design 2026-07-20-asset-portal-slice-1;
-- domain-spec §12/§13; golden rules 5/10/12/14). An account-less recipient opens
-- a single-purpose link, proves identity via an emailed code, and downloads a
-- delivery's master over a signed CloudFront URL. Four tables + three RPCs.
-- portal_access_events is the recipient-side provenance record (append-only;
-- audit_log is for authenticated org actions, which this is not).
--
-- Write model: portal_links via GC-only create/revoke RPCs; portal_otps /
-- portal_sessions / portal_access_events by the service-role route handlers
-- (service_role is the intended writer — no user write path — so, unlike the
-- repo's user-RPC tables, service_role is NOT revoked here; the append-only
-- table revokes UPDATE/DELETE from everyone incl. service_role). portal_resolve_
-- download holds the crown-jewel authz (session + rule-12 grant re-check).
--
-- DESTRUCTIVE OPS (approved before apply): create type + 4 tables + 3 functions;
-- revokes (incl. UPDATE/DELETE on the append-only table). Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.portal_event as enum ('room_viewed','otp_sent','otp_verified','download');
exception when duplicate_object then null; end $$;

create table if not exists public.portal_links (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  asset_id    uuid not null references public.assets(id)     on delete restrict,
  token_hash  text not null unique,
  created_by  uuid references auth.users(id),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_links_delivery_idx on public.portal_links (delivery_id);
create index if not exists portal_links_asset_idx    on public.portal_links (asset_id);

create table if not exists public.portal_otps (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int  not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_otps_link_idx on public.portal_otps (link_id);

create table if not exists public.portal_sessions (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  token_hash  text not null unique,
  name        text not null,
  company     text not null,
  email       text not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_sessions_link_idx on public.portal_sessions (link_id);

create table if not exists public.portal_access_events (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  session_id  uuid references public.portal_sessions(id),
  event_type  public.portal_event not null,
  email       text,
  name        text,
  company     text,
  ip          inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);
create index if not exists portal_access_events_link_idx on public.portal_access_events (link_id);
create index if not exists portal_access_events_at_idx   on public.portal_access_events (occurred_at desc);

-- ---- RLS: GC-only reads; no anon; no authenticated-user writes -------------
alter table public.portal_links         enable row level security;
alter table public.portal_otps          enable row level security;
alter table public.portal_sessions      enable row level security;
alter table public.portal_access_events enable row level security;

revoke all on public.portal_links, public.portal_otps, public.portal_sessions,
             public.portal_access_events from anon;
revoke insert, update, delete on public.portal_links, public.portal_otps,
             public.portal_sessions, public.portal_access_events from authenticated;
-- append-only (rule 5): even service_role cannot mutate access events.
revoke update, delete on public.portal_access_events from service_role;

drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_otps_select on public.portal_otps;
create policy portal_otps_select on public.portal_otps for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_sessions_select on public.portal_sessions;
create policy portal_sessions_select on public.portal_sessions for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_access_events_select on public.portal_access_events;
create policy portal_access_events_select on public.portal_access_events for select to authenticated
  using (public.is_gc_staff(auth.uid()));

-- ---- create_portal_link (GC-only) -----------------------------------------
create or replace function public.create_portal_link(
  p_delivery_id uuid, p_asset_id uuid, p_token_hash text, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_title uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select title_id into v_title from public.deliveries where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
  if not exists (
    select 1 from public.assets
    where id = p_asset_id and title_id = v_title and kind = 'master'
  ) then raise exception 'Asset must be a master asset on the delivery''s title'; end if;
  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  insert into public.portal_links (delivery_id, asset_id, token_hash, created_by, expires_at)
  values (p_delivery_id, p_asset_id, btrim(p_token_hash), auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_portal_link(uuid, uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_portal_link(uuid, uuid, text, timestamptz) to authenticated;

-- ---- revoke_portal_link (GC-only) -----------------------------------------
create or replace function public.revoke_portal_link(p_link_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;
end; $$;
revoke execute on function public.revoke_portal_link(uuid) from public, anon;
grant  execute on function public.revoke_portal_link(uuid) to authenticated;

-- ---- portal_resolve_download (service-role only): session + rule-12 recheck -
create or replace function public.portal_resolve_download(p_session_token_hash text)
  returns table(storage_key text, link_id uuid, session_id uuid)
  language plpgsql security definer set search_path = public as $$
declare
  v_sess public.portal_sessions%rowtype;
  v_link public.portal_links%rowtype;
  v_deliv public.deliveries%rowtype;
begin
  select * into v_sess from public.portal_sessions
    where token_hash = p_session_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'Session expired or not found'; end if;

  select * into v_link from public.portal_links
    where id = v_sess.link_id and revoked_at is null and expires_at > now();
  if not found then raise exception 'Link expired or revoked'; end if;

  select * into v_deliv from public.deliveries where id = v_link.delivery_id;
  if not found then raise exception 'Delivery not found'; end if;

  -- Rule 12: the delivery's SPECIFIC grant must still be active + in-window + cover territory.
  if not exists (
    select 1 from public.rights_grants g
    where g.id = v_deliv.grant_id and g.title_id = v_deliv.title_id and g.effective_to is null
      and (g.window_start is null or now() >= g.window_start)
      and (g.window_end   is null or now() <= g.window_end)
      and case g.territory_mode
            when 'world'   then true
            when 'include' then v_deliv.territory = any (g.territories)
            when 'exclude' then not (v_deliv.territory = any (g.territories))
          end
  ) then raise exception 'This delivery is no longer covered by an active grant'; end if;

  return query
    select a.storage_key, v_link.id, v_sess.id
    from public.assets a where a.id = v_link.asset_id;
end; $$;
revoke execute on function public.portal_resolve_download(text) from public, anon, authenticated;
grant  execute on function public.portal_resolve_download(text) to service_role;
```

- [ ] **Step 4: STOP — get destructive-ops approval**

Show the user the full migration SQL (tables, triggers, revokes) and get explicit approval per CLAUDE.md's Destructive-Ops Rule. Do NOT apply until approved.

- [ ] **Step 5: Apply the migration and run the test**

Run: `supabase db reset` (applies all migrations to local) then `supabase test db`
Expected: PASS — `portal_test.sql` reports `ok 1..14`.

- [ ] **Step 6: Regenerate TypeScript types**

Run: `supabase gen types typescript --local > src/lib/supabase/database.types.ts`
Then: `pnpm typecheck`
Expected: types include `portal_links` etc. and the three RPCs; typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260720000100_portal_gate.sql supabase/tests/portal_test.sql src/lib/supabase/database.types.ts
git commit -m "feat(portal): gate schema + RPCs (portal_links/otps/sessions/access_events)"
```

---

## Task 2: Pure logic + copy — `src/lib/portal.ts`

**Files:**
- Create: `src/lib/portal.ts`
- Test: `src/lib/portal.test.ts`

**Interfaces:**
- Produces:
  - `PORTAL` const: `{ linkTtlDays: 14, otpTtlMinutes: 10, otpMaxAttempts: 5, sessionTtlHours: 24, signedUrlTtlSeconds: 300, sessionCookie: "portal_session" }`
  - `generateToken(): string` — 32 random bytes, base64url.
  - `hashToken(raw: string): string` — sha256 hex.
  - `generateOtpCode(): string` — 6-digit zero-padded.
  - `hashOtp(code: string, linkId: string): string` — sha256 hex of `linkId + ":" + code`.
  - `safeEqualHex(a: string, b: string): boolean` — constant-time hex compare.
  - `PORTAL_COPY` const: user-facing strings.

- [ ] **Step 1: Write the failing test**

Create `src/lib/portal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PORTAL, generateToken, hashToken, generateOtpCode, hashOtp, safeEqualHex } from "./portal";

describe("portal crypto", () => {
  it("generates distinct URL-safe tokens", () => {
    const a = generateToken(), b = generateToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
  it("hashToken is stable and 64-hex", () => {
    expect(hashToken("abc")).toEqual(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("otp code is 6 digits", () => {
    for (let i = 0; i < 50; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
  it("hashOtp is salted by linkId", () => {
    expect(hashOtp("123456", "link-1")).not.toEqual(hashOtp("123456", "link-2"));
    expect(hashOtp("123456", "link-1")).toEqual(hashOtp("123456", "link-1"));
  });
  it("safeEqualHex compares equal-length hex", () => {
    expect(safeEqualHex(hashToken("x"), hashToken("x"))).toBe(true);
    expect(safeEqualHex(hashToken("x"), hashToken("y"))).toBe(false);
    expect(safeEqualHex("aa", "aabb")).toBe(false);
  });
  it("PORTAL constants match spec", () => {
    expect(PORTAL.otpTtlMinutes).toBe(10);
    expect(PORTAL.otpMaxAttempts).toBe(5);
    expect(PORTAL.sessionTtlHours).toBe(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/portal.test.ts`
Expected: FAIL — cannot resolve `./portal`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/portal.ts`:

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PORTAL = {
  linkTtlDays: 14,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  sessionTtlHours: 24,
  signedUrlTtlSeconds: 300,
  sessionCookie: "portal_session",
} as const;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, linkId: string): string {
  return createHash("sha256").update(`${linkId}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export const PORTAL_COPY = {
  roomTitle: "Secure delivery",
  roomIntro: "Confirm your details to access the file we've sent you.",
  identitySubmit: "Send verification code",
  codePrompt: "Enter the 6-digit code we emailed you.",
  codeSubmit: "Verify",
  downloadPrompt: "Your file is ready.",
  downloadButton: "Download",
  errorExpired: "This link has expired or been withdrawn. Contact your Global Content representative.",
  errorBadCode: "That code is incorrect or has expired. Request a new one.",
  errorTooMany: "Too many attempts. Request a new code.",
  errorPreparing: "This file is being retrieved from cold storage and isn't ready yet. Try again shortly.",
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/portal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal.ts src/lib/portal.test.ts
git commit -m "feat(portal): pure crypto + constants + copy (portal.ts)"
```

---

## Task 3: CloudFront signer — `src/lib/cloudfront.ts`

**Files:**
- Create: `src/lib/cloudfront.ts`
- Test: `src/lib/cloudfront.test.ts`
- Modify: `package.json` (add `@aws-sdk/cloudfront-signer`)

**Interfaces:**
- Consumes: env `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`; `PORTAL.signedUrlTtlSeconds`.
- Produces: `signAssetUrl(storageKey: string, ttlSeconds?: number): string` — a CloudFront signed URL over the private distribution.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add @aws-sdk/cloudfront-signer`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `src/lib/cloudfront.test.ts`. It generates a throwaway RSA key so signing is exercised without real infra:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";

describe("signAssetUrl", () => {
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CLOUDFRONT_DOMAIN = "https://d.example.net";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "KTESTPAIRID";
    process.env.CLOUDFRONT_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  });

  it("produces a signed URL for a storage key", async () => {
    const { signAssetUrl } = await import("./cloudfront");
    const url = signAssetUrl("orgs/x/titles/y/master/z/film.mov");
    expect(url).toContain("https://d.example.net/orgs/x/titles/y/master/z/film.mov");
    expect(url).toContain("Key-Pair-Id=KTESTPAIRID");
    expect(url).toMatch(/Signature=/);
    expect(url).toMatch(/Expires=/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/cloudfront.test.ts`
Expected: FAIL — cannot resolve `./cloudfront`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/cloudfront.ts`:

```ts
import "server-only";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { PORTAL } from "@/lib/portal";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Mint a short-lived CloudFront signed URL for a private S3-backed object key. */
export function signAssetUrl(storageKey: string, ttlSeconds: number = PORTAL.signedUrlTtlSeconds): string {
  const domain = requireEnv("CLOUDFRONT_DOMAIN").replace(/\/+$/, "");
  const keyPairId = requireEnv("CLOUDFRONT_KEY_PAIR_ID");
  const privateKey = requireEnv("CLOUDFRONT_PRIVATE_KEY");
  const key = storageKey.replace(/^\/+/, "");
  return getSignedUrl({
    url: `${domain}/${key}`,
    keyPairId,
    privateKey,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/cloudfront.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cloudfront.ts src/lib/cloudfront.test.ts package.json pnpm-lock.yaml
git commit -m "feat(portal): server-only CloudFront URL signer"
```

---

## Task 4: Email — `src/lib/email.ts` (Resend)

**Files:**
- Create: `src/lib/email.ts`
- Test: `src/lib/email.test.ts`
- Modify: `package.json` (add `resend`)

**Interfaces:**
- Consumes: env `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`.
- Produces:
  - `buildOtpEmail(code: string): { subject: string; text: string; html: string }` — pure.
  - `sendOtpEmail(to: string, code: string): Promise<void>` — sends via Resend.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add resend`

- [ ] **Step 2: Write the failing test (pure builder only)**

Create `src/lib/email.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildOtpEmail } from "./email";

describe("buildOtpEmail", () => {
  it("includes the code and no banned words", () => {
    const { subject, text, html } = buildOtpEmail("012345");
    expect(text).toContain("012345");
    expect(html).toContain("012345");
    expect(subject.toLowerCase()).not.toMatch(/seamless|frictionless|elevate|amplify/);
    expect(text).toMatch(/10 minutes/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/email.test.ts`
Expected: FAIL — cannot resolve `./email`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/email.ts`:

```ts
import "server-only";
import { Resend } from "resend";
import { PORTAL } from "@/lib/portal";

export function buildOtpEmail(code: string): { subject: string; text: string; html: string } {
  const subject = "Your Global Content access code";
  const text =
    `Your verification code is ${code}.\n\n` +
    `It expires in ${PORTAL.otpTtlMinutes} minutes. If you didn't request this, you can ignore this message.`;
  const html =
    `<p>Your verification code is</p>` +
    `<p style="font-size:24px;font-weight:600;letter-spacing:2px">${code}</p>` +
    `<p>It expires in ${PORTAL.otpTtlMinutes} minutes. If you didn't request this, you can ignore this message.</p>`;
  return { subject, text, html };
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PORTAL_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or PORTAL_EMAIL_FROM");
  const { subject, text, html } = buildOtpEmail(code);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, text, html });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/email.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts package.json pnpm-lock.yaml
git commit -m "feat(portal): Resend OTP email wrapper + builder"
```

---

## Task 5: Public-route exemption in middleware

**Files:**
- Modify: `src/lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: existing `isPublic` prefix check.
- Produces: `/portal/*` and `/api/portal/*` reachable without a session.

- [ ] **Step 1: Add the prefixes**

In `src/lib/supabase/middleware.ts`, find the `isPublic` expression (currently `path.startsWith("/login") || path.startsWith("/auth") || path === "/api/stripe/webhook"`) and extend it:

```ts
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/portal") ||       // account-less asset-access portal (token-gated)
    path.startsWith("/api/portal") ||   // portal route handlers (token/OTP/session gated in-handler)
    path === "/api/stripe/webhook";
```

- [ ] **Step 2: Verify build + typecheck**

Run: `pnpm typecheck && pnpm build`
Expected: PASS (no route errors). Manual smoke: `pnpm dev`, hit `http://localhost:3000/portal/nope` while logged out — it should render the portal route (an "invalid link" state once Task 6 lands), NOT redirect to `/login`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/middleware.ts
git commit -m "feat(portal): exempt /portal and /api/portal from the auth wall"
```

---

## Task 6: `/api/portal/request-otp` route handler

**Files:**
- Create: `src/app/api/portal/request-otp/route.ts`

**Interfaces:**
- Consumes: `createAdminClient()` from `@/lib/supabase/admin`; `hashToken`, `hashOtp`, `generateOtpCode`, `PORTAL` from `@/lib/portal`; `sendOtpEmail` from `@/lib/email`.
- Produces: `POST` accepting `{ token, name, company, email }` → creates OTP + emails it; logs `room_viewed` (first time) + `otp_sent`. Returns `{ ok: true }` or a 4xx.

- [ ] **Step 1: Write the implementation**

Create `src/app/api/portal/request-otp/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, hashOtp, generateOtpCode, PORTAL } from "@/lib/portal";
import { sendOtpEmail } from "@/lib/email";

const Body = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { token, name, company, email } = parsed.data;

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired or withdrawn" }, { status: 404 });
  }

  const ua = req.headers.get("user-agent") ?? null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // First contact for this link+email → record room_viewed once.
  const { count } = await admin
    .from("portal_access_events")
    .select("id", { count: "exact", head: true })
    .eq("link_id", link.id)
    .eq("event_type", "room_viewed")
    .eq("email", email);
  if (!count) {
    await admin.from("portal_access_events").insert({
      link_id: link.id, event_type: "room_viewed", email, name, company, ip, user_agent: ua,
    });
  }

  const code = generateOtpCode();
  await admin.from("portal_otps").insert({
    link_id: link.id,
    email,
    code_hash: hashOtp(code, link.id),
    expires_at: new Date(Date.now() + PORTAL.otpTtlMinutes * 60_000).toISOString(),
  });
  await sendOtpEmail(email, code);
  await admin.from("portal_access_events").insert({
    link_id: link.id, event_type: "otp_sent", email, name, company, ip, user_agent: ua,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (relies on regenerated `database.types.ts` from Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portal/request-otp/route.ts
git commit -m "feat(portal): request-otp route (issue + email code, log room_viewed/otp_sent)"
```

---

## Task 7: `/api/portal/verify-otp` route handler

**Files:**
- Create: `src/app/api/portal/verify-otp/route.ts`

**Interfaces:**
- Consumes: `createAdminClient()`; `hashToken`, `hashOtp`, `safeEqualHex`, `generateToken`, `PORTAL` from `@/lib/portal`.
- Produces: `POST` accepting `{ token, email, code }` → verifies, creates a session, sets the `portal_session` httpOnly cookie, logs `otp_verified`. Returns `{ ok: true }` or a 4xx.

- [ ] **Step 1: Write the implementation**

Create `src/app/api/portal/verify-otp/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, hashOtp, safeEqualHex, generateToken, PORTAL } from "@/lib/portal";

const Body = z.object({
  token: z.string().min(1),
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { token, email, code } = parsed.data;

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired or withdrawn" }, { status: 404 });
  }

  const { data: otp } = await admin
    .from("portal_otps")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("link_id", link.id)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!otp || new Date(otp.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code incorrect or expired" }, { status: 400 });
  }
  if (otp.attempts >= PORTAL.otpMaxAttempts) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  await admin.from("portal_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
  if (!safeEqualHex(otp.code_hash, hashOtp(code, link.id))) {
    return NextResponse.json({ error: "Code incorrect or expired" }, { status: 400 });
  }

  // Recover the captured identity from the room_viewed/otp_sent event.
  const { data: idEvent } = await admin
    .from("portal_access_events")
    .select("name, company")
    .eq("link_id", link.id)
    .eq("email", email)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await admin.from("portal_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

  const sessionToken = generateToken();
  const { data: session, error: sErr } = await admin
    .from("portal_sessions")
    .insert({
      link_id: link.id,
      token_hash: hashToken(sessionToken),
      name: idEvent?.name ?? "",
      company: idEvent?.company ?? "",
      email,
      expires_at: new Date(Date.now() + PORTAL.sessionTtlHours * 3_600_000).toISOString(),
    })
    .select("id")
    .single();
  if (sErr || !session) return NextResponse.json({ error: "Could not start session" }, { status: 500 });

  await admin.from("portal_access_events").insert({
    link_id: link.id, session_id: session.id, event_type: "otp_verified", email,
    name: idEvent?.name, company: idEvent?.company,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL.sessionCookie, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL.sessionTtlHours * 3600,
  });
  return res;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portal/verify-otp/route.ts
git commit -m "feat(portal): verify-otp route (verify, session + cookie, log otp_verified)"
```

---

## Task 8: `/api/portal/download` route handler

**Files:**
- Create: `src/app/api/portal/download/route.ts`

**Interfaces:**
- Consumes: `createAdminClient()`; `hashToken`, `PORTAL` from `@/lib/portal`; `signAssetUrl` from `@/lib/cloudfront`; RPC `portal_resolve_download`.
- Produces: `POST` (no body) reading the `portal_session` cookie → resolves + signs → logs `download` → returns `{ type: "progressive", url }`.

- [ ] **Step 1: Write the implementation**

Create `src/app/api/portal/download/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { signAssetUrl } from "@/lib/cloudfront";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_download", {
    p_session_token_hash: hashToken(raw),
  });
  // RPC returns a set; grab the first row. Any auth failure raises → error is set.
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let url: string;
  try {
    url = signAssetUrl(row.storage_key);
  } catch {
    // Object not retrievable (e.g. Glacier) or signing misconfig — graceful (Slice-3 seam).
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  await admin.from("portal_access_events").insert({
    link_id: row.link_id,
    session_id: row.session_id,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });

  return NextResponse.json({ type: "progressive", url });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portal/download/route.ts
git commit -m "feat(portal): download route (session + grant recheck via RPC, sign, log download)"
```

---

## Task 9: Public portal page + flow UI

**Files:**
- Create: `src/app/portal/layout.tsx`
- Create: `src/app/portal/[token]/page.tsx`
- Create: `src/app/portal/[token]/portal-flow.tsx`

**Interfaces:**
- Consumes: `createAdminClient()`; `hashToken` from `@/lib/portal`; `PORTAL_COPY`; the three `/api/portal/*` routes; UI primitives `Card`/`CardBody` (`@/components/ui/card`), `Button` (`@/components/ui/button`), `Input` (`@/components/ui/input`), `Label`, `InlineNotice`.
- Produces: the branded `/portal/[token]` experience.

- [ ] **Step 1: Write the branded layout**

Create `src/app/portal/layout.tsx` (a minimal shell outside the app/gc chromes; tokens only):

```tsx
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 t-label text-ink-3">Global Content</div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the page (server component — validate link, then hand to the client flow)**

Create `src/app/portal/[token]/page.tsx`:

```tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL_COPY } from "@/lib/portal";
import { Card, CardBody } from "@/components/ui/card";
import { PortalFlow } from "./portal-flow";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, expires_at, revoked_at, assets(original_filename, bytes)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  const valid = link && !link.revoked_at && new Date(link.expires_at) >= new Date();
  if (!valid) {
    return (
      <Card>
        <CardBody>
          <h1 className="t-subhead mb-2">{PORTAL_COPY.roomTitle}</h1>
          <p className="t-body text-ink-2">{PORTAL_COPY.errorExpired}</p>
        </CardBody>
      </Card>
    );
  }

  const asset = Array.isArray(link.assets) ? link.assets[0] : link.assets;
  return (
    <PortalFlow
      token={token}
      filename={asset?.original_filename ?? "master"}
      bytes={asset?.bytes ?? 0}
    />
  );
}
```

- [ ] **Step 3: Write the client flow**

Create `src/app/portal/[token]/portal-flow.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PORTAL_COPY } from "@/lib/portal";

type Stage = "identity" | "code" | "ready";

export function PortalFlow({ token, filename, bytes }: { token: string; filename: string; bytes: number }) {
  const [stage, setStage] = useState<Stage>("identity");
  const [name, setName] = useState(""); const [company, setCompany] = useState("");
  const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const r = await fetch("/api/portal/request-otp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, company, email }),
    });
    setBusy(false);
    if (!r.ok) return setError(PORTAL_COPY.errorExpired);
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const r = await fetch("/api/portal/verify-otp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, email, code }),
    });
    setBusy(false);
    if (r.status === 429) return setError(PORTAL_COPY.errorTooMany);
    if (!r.ok) return setError(PORTAL_COPY.errorBadCode);
    setStage("ready");
  }

  async function download() {
    setBusy(true); setError(null);
    const r = await fetch("/api/portal/download", { method: "POST" });
    setBusy(false);
    if (r.status === 409) return setError(PORTAL_COPY.errorPreparing);
    if (!r.ok) return setError(PORTAL_COPY.errorExpired);
    const { url } = await r.json();
    window.location.href = url;
  }

  return (
    <Card>
      <CardBody>
        <h1 className="t-subhead mb-1">{PORTAL_COPY.roomTitle}</h1>
        {error && <InlineNotice tone="warning" className="my-3">{error}</InlineNotice>}

        {stage === "identity" && (
          <form onSubmit={requestOtp} className="space-y-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.roomIntro}</p>
            <div><Label htmlFor="n">Name</Label><Input id="n" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label htmlFor="c">Company</Label><Input id="c" required value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div><Label htmlFor="e">Email</Label><Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <Button type="submit" disabled={busy}>{PORTAL_COPY.identitySubmit}</Button>
          </form>
        )}

        {stage === "code" && (
          <form onSubmit={verify} className="space-y-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.codePrompt}</p>
            <Input inputMode="numeric" pattern="\d{6}" required value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" disabled={busy}>{PORTAL_COPY.codeSubmit}</Button>
          </form>
        )}

        {stage === "ready" && (
          <div className="space-y-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.downloadPrompt}</p>
            <p className="t-body-sm text-ink-3">{filename} · {(bytes / 1e9).toFixed(2)} GB</p>
            <Button onClick={download} disabled={busy}>{PORTAL_COPY.downloadButton}</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

> If `InlineNotice` does not accept a `tone`/`className` prop as written, open `src/components/ui/inline-notice.tsx` and match its actual prop names — do not invent props.

- [ ] **Step 4: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. Manual: `pnpm dev` → an invalid `/portal/xxx` shows the expired-link card.

- [ ] **Step 5: Commit**

```bash
git add src/app/portal
git commit -m "feat(portal): branded public /portal/[token] identity→code→download flow"
```

---

## Task 10: GC link management on `/gc/deliveries`

**Files:**
- Modify: `src/app/gc/deliveries/actions.ts`
- Modify: `src/app/gc/deliveries/page.tsx`
- Create: `src/app/gc/deliveries/portal-links.tsx`

**Interfaces:**
- Consumes: `createClient()` (user-JWT, GC); `generateToken`, `hashToken` from `@/lib/portal`; RPCs `create_portal_link`, `revoke_portal_link`; env `PORTAL_BASE_URL`.
- Produces: server actions `createPortalLink(deliveryId, assetId)` (returns the full `/portal/<token>` URL once) and `revokePortalLink(linkId)`; a GC UI listing a delivery's master assets, its links (status), and its access events.

- [ ] **Step 1: Add the server actions**

Append to `src/app/gc/deliveries/actions.ts`:

```ts
import { generateToken, hashToken } from "@/lib/portal";

export async function createPortalLink(input: { deliveryId: string; assetId: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const token = generateToken();
  const { error } = await supabase.rpc("create_portal_link", {
    p_delivery_id: input.deliveryId,
    p_asset_id: input.assetId,
    p_token_hash: hashToken(token),
  });
  if (error) return { error: error.message };
  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath("/gc/deliveries");
  return { url: `${base}/portal/${token}` };
}

export async function revokePortalLink(input: { linkId: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase.rpc("revoke_portal_link", { p_link_id: input.linkId });
  if (error) return { error: error.message };
  revalidatePath("/gc/deliveries");
  return {};
}
```

- [ ] **Step 2: Load links + master assets + events in the page**

In `src/app/gc/deliveries/page.tsx`, after the existing deliveries query, add reads (GC RLS already permits these SELECTs) and pass them to a `<PortalLinks>` per delivery. Example additions:

```tsx
// master assets available to link, per title on the page
const { data: masters } = await supabase
  .from("assets")
  .select("id, title_id, original_filename, bytes")
  .eq("kind", "master");

const { data: links } = await supabase
  .from("portal_links")
  .select("id, delivery_id, asset_id, expires_at, revoked_at, created_at");

const { data: events } = await supabase
  .from("portal_access_events")
  .select("link_id, event_type, email, company, occurred_at")
  .order("occurred_at", { ascending: false });
```

Render `<PortalLinks delivery={...} masters={mastersForTitle} links={linksForDelivery} events={eventsForLinks} />` inside each delivery row.

- [ ] **Step 3: Write the client component**

Create `src/app/gc/deliveries/portal-links.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createPortalLink, revokePortalLink } from "./actions";

type Master = { id: string; original_filename: string | null; bytes: number };
type Link = { id: string; asset_id: string; expires_at: string; revoked_at: string | null };
type Event = { link_id: string; event_type: string; email: string | null; company: string | null; occurred_at: string };

export function PortalLinks({
  deliveryId, masters, links, events,
}: { deliveryId: string; masters: Master[]; links: Link[]; events: Event[] }) {
  const [assetId, setAssetId] = useState(masters[0]?.id ?? "");
  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null); setGenerated(null);
    const r = await createPortalLink({ deliveryId, assetId });
    if (r.error) return setError(r.error);
    setGenerated(r.url ?? null);
  }
  async function revoke(linkId: string) {
    const r = await revokePortalLink({ linkId });
    if (r.error) setError(r.error);
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="t-label text-ink-3">Send master</div>
      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
      {masters.length === 0 ? (
        <p className="t-body-sm text-ink-3">No master asset uploaded for this title yet.</p>
      ) : (
        <div className="flex gap-2 items-center">
          <select className="border-hairline rounded-[var(--radius-sm)] p-2 t-body-sm"
                  value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.original_filename ?? m.id}</option>)}
          </select>
          <Button variant="secondary" onClick={generate}>Generate link</Button>
        </div>
      )}
      {generated && (
        <InlineNotice tone="info">
          Link (copy into your email): <code className="break-all">{generated}</code>
        </InlineNotice>
      )}
      {links.filter((l) => !l.revoked_at).map((l) => (
        <div key={l.id} className="flex justify-between items-center t-body-sm">
          <span>Active · expires {new Date(l.expires_at).toLocaleDateString()}</span>
          <Button variant="ghost" onClick={() => revoke(l.id)}>Revoke</Button>
        </div>
      ))}
      {events.length > 0 && (
        <div className="t-body-sm text-ink-3">
          {events.map((ev, i) => (
            <div key={i}>{ev.event_type} · {ev.email ?? "—"} · {new Date(ev.occurred_at).toLocaleString()}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Match `InlineNotice`/`Button` actual prop names; if `tone="info"` isn't supported, use whatever the primitive exposes.

- [ ] **Step 4: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/gc/deliveries/actions.ts src/app/gc/deliveries/page.tsx src/app/gc/deliveries/portal-links.tsx
git commit -m "feat(portal): GC generate/revoke portal links + access-event view on /gc/deliveries"
```

---

## Task 11: Infra docs, env, and full verification

**Files:**
- Create: `docs/infra/asset-portal-setup.md`

**Interfaces:** none (docs + verification).

- [ ] **Step 1: Write the infra/provisioning doc**

Create `docs/infra/asset-portal-setup.md` documenting (mirror `docs/infra/asset-storage-setup.md`'s style):
- CloudFront distribution over the private assets bucket via **Origin Access Control** (S3 stays private).
- GC custom subdomain + **ACM cert** (us-east-1 for CloudFront) + Route 53 record.
- CloudFront **key group** + public key; the private key stored as the `CLOUDFRONT_PRIVATE_KEY` secret (never committed).
- Resend account + verified sending domain; `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`.
- Env var table: `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`, `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`, `PORTAL_BASE_URL` — set in `.env.local` and Vercel; none `NEXT_PUBLIC_`.

- [ ] **Step 2: Run the full suite**

Run each and confirm green:
```bash
supabase test db        # pgTAP: portal_test.sql ok 1..14
pnpm test               # Vitest: portal / cloudfront / email
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 3: Leak check**

Invoke the `/leak-check` skill. Confirm no `CLOUDFRONT_PRIVATE_KEY`, `RESEND_API_KEY`, or service-role key appears in the client bundle, and no portal secret is `NEXT_PUBLIC_`.

- [ ] **Step 4: Manual end-to-end (once CloudFront + Resend are provisioned)**

1. As GC, open `/gc/deliveries`, pick a delivery whose title has a master, Generate link, copy the URL.
2. In a logged-out browser, open the URL → enter name/company/email → receive the code (Resend) → verify → Download → file downloads via the signed CloudFront URL.
3. In `/gc/deliveries`, confirm `room_viewed`, `otp_sent`, `otp_verified`, `download` all appear in the access-event list.
4. Revoke the link → reopening the URL shows the expired-link card; `/api/portal/download` returns 403.
5. Negative: expire an OTP (wait 10 min or edit `expires_at`) → verify rejects; exceed 5 attempts → 429.

- [ ] **Step 5: Commit**

```bash
git add docs/infra/asset-portal-setup.md
git commit -m "docs(portal): CloudFront + Resend provisioning + env for the asset portal"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** public route (Task 5,9) · `portal_links`/`portal_otps`/`portal_sessions`/`portal_access_events` (Task 1) · `create_portal_link` returning token once + master-only + delivery scoping (Task 1,10) · full OTP gate w/ hashing + attempt cap + expiry (Task 1,2,6,7) · session row + cookie (Task 1,7) · append-only recipient audit incl. all 4 event types (Task 1,6,7,8) · grant re-check at download / rule 12 (Task 1,8) · CloudFront signing behind URL indirection returning `{type:'progressive',url}` (Task 3,8) · Glacier graceful branch (Task 8) · GC generate/revoke + events (Task 10) · pgTAP + Vitest + manual (Task 1–11) · provisioning (Task 11). No gaps.
- **Runtime deviation from spec wording:** spec says "edge functions"; implemented as Next.js route handlers + service-role admin client (repo has no edge runtime; this is the repo's established rule-14/10 pattern). Same security properties. Flagged in Architecture.
- **Placeholder scan:** no TBD/TODO; every code step has real code. Two `>` notes tell the implementer to match actual `InlineNotice`/`Button` props rather than invent them — verification, not a placeholder.
- **Type consistency:** `hashToken`/`hashOtp`/`generateToken`/`safeEqualHex`/`PORTAL`/`PORTAL_COPY` used identically across Tasks 2/6/7/8/9/10; `portal_resolve_download` return columns (`storage_key`,`link_id`,`session_id`) match Task 8's usage; cookie name `PORTAL.sessionCookie` shared by Tasks 7/8; `create_portal_link(uuid,uuid,text,timestamptz)` signature matches Task 10's call (3 args + defaulted 4th).
```
