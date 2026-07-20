# Asset-Access Portal — Slice 2 (Screener Room) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A pitch-stage screener room — an account-less prospect proves identity by OTP (reusing the Portal-1 gate) and watches a title's screener in an instrumented player streaming from S3 via CloudFront; GC generates/revokes screener links and sees a per-viewer watch summary.

**Architecture:** Reuse the entire Portal-1 gate (`portal_otps`/`portal_sessions`/`portal_access_events`, `request-otp`/`verify-otp`, CloudFront signer, middleware exemption, `portal.ts`). Generalize `portal_links` with a `purpose` discriminator so screener links share that gate. Add a `screener` asset kind, a per-title `screener_source` (`master|dedicated`) choice, an append-only `screener_view_events` capture table, three RPCs (`create_screener_link`, `portal_resolve_screener`, `screener_engagement`), two new session-gated routes, an instrumented `<video>`, a `purpose` branch in the public page, and a GC panel on `/gc/review`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), zod, Vitest + pgTAP. pnpm. Reuses `@aws-sdk/cloudfront-signer`, service-role admin client.

**Branch:** `portal-2-screener-room`, stacked on `portal-1-master-download` (PR #13). Do not merge before #13.

## Global Constraints (verbatim; bind every task)

- **pnpm** only. **RLS is the authorization layer** — new tables: `enable rls`, `revoke all from anon`, GC-only SELECT policy, writes revoked from `authenticated`.
- **Rule 5 — append-only:** `screener_view_events` UPDATE/DELETE revoked from everyone incl. `service_role`.
- **Rule 10 — server-side:** resolve/sign/event-write logic in RPCs + route handlers (service-role admin client), never client.
- **Rule 14 — S3 key server-side only;** the screener streams via a short-lived CloudFront signed URL minted server-side; the storage_key never reaches the client.
- **Rule 12 does NOT apply to the pitch view** — no grant/territory/delivery gate on the screener; OTP identity only. (Founder-confirmed.)
- **Rule 2 — nothing deleted:** link revocation is `revoked_at` (soft), reusing `revoke_portal_link`.
- **`screener_source` explicit + gated:** `create_screener_link` refuses when `dedicated` but no completed screener asset exists (and when `master` but no master exists).
- **Analytics = Postgres + (later) house charting**, never AWS analytics infra. AWS stays S3 + CloudFront.
- **Bearer secrets hashed** (link token, session token) — reuse `hashToken`. **Optional RPC args declared `default null`** (repo gotcha).
- **Design tokens only** (neutral accent); **copy in `lib/`** (`PORTAL_COPY`); voice calm/declarative; banned words apply.
- **Destructive-ops approval gate:** migrations (enum add, ALTER portal_links, new table, RPCs, revokes) shown + founder-approved BEFORE `supabase db reset`. Hard stop in Task 1.
- **Secrets server-only**, run `/leak-check` before shipping.

## File Structure

**Create:**
- `supabase/migrations/20260720000200_screener_asset_kind.sql` — enum add-value only (own migration).
- `supabase/migrations/20260720000300_screener_room.sql` — screener_source, portal_links generalization, screener_view_events, 3 RPCs.
- `supabase/tests/screener_test.sql` — pgTAP.
- `src/app/api/portal/screener/route.ts` — resolve + sign the stream URL.
- `src/app/api/portal/screener-event/route.ts` — append a playback event.
- `src/app/portal/[token]/screener-room.tsx` — `"use client"` instrumented player + curated info.
- `src/app/gc/review/screener-panel.tsx` — `"use client"` GC generate/revoke + per-viewer summary.

**Modify:**
- `src/lib/supabase/database.types.ts` — regenerated after migrations.
- `src/lib/portal.ts` — extend `PORTAL_COPY` with screener-room strings.
- `src/app/api/assets/initiate/route.ts` + `complete/route.ts` — add `"screener"` to the kind zod enum.
- `src/app/(app)/titles/[id]/asset-upload.tsx` — add `screener` to `Kind` + dropdown.
- `src/app/(app)/titles/[id]/page.tsx` — `ASSET_KIND_LABELS` += screener; render the `ScreenerSource` control.
- `src/app/(app)/titles/[id]/actions.ts` — `setScreenerSource` server action.
- `src/app/portal/[token]/page.tsx` — resolve `purpose`/`title_id` + title metadata; branch to `ScreenerRoom` for `screener_view`.
- `src/app/gc/review/page.tsx` + `actions.ts` — load links/summary; `createScreenerLink`/`revokeScreenerLink`; render `ScreenerPanel`.

---

## Task 1 — Migrations + RPCs + pgTAP  *(WEIGHT: heavy — fresh subagent + full review; destructive-ops STOP)*

**Files:** create the two migrations + `supabase/tests/screener_test.sql`; regenerate `database.types.ts`.

**Interfaces produced:**
- `create_screener_link(p_title_id uuid, p_token_hash text, p_expires_at timestamptz default null) returns uuid`
- `portal_resolve_screener(p_session_token_hash text) returns table(storage_key text, link_id uuid, session_id uuid, title_id uuid)`
- `screener_engagement(p_link_id uuid) returns table(session_id uuid, name text, company text, email text, watched_pct int, completed boolean, replays int, last_viewed timestamptz)`
- table `screener_view_events`; enum `screener_event`; `asset_kind += screener`; `titles.screener_source`; generalized `portal_links`.

- [ ] **Step 1 — pgTAP first** (`supabase/tests/screener_test.sql`). Cover: `create_screener_link` GC-only; screenable gate (dedicated w/o screener asset → refuse; master path lives_ok; dedicated with screener asset lives_ok); past-expiry refused; the row lands `purpose='screener_view'` with the CHECK satisfied. `portal_resolve_screener` resolves master vs dedicated source correctly; refuses expired/revoked session, expired/revoked link, and a `master_download`-purpose link. `screener_engagement` math on seeded events (watched_pct, completed via ended and via ≥95%, replays = ended−1 floored). RLS: client denied SELECT on `screener_view_events` + screener links; `screener_view_events` UPDATE/DELETE revoked incl. service_role. The Portal-1 `portal_links` CHECK still lets a `master_download` row insert. Use the fixture idioms from `supabase/tests/portal_test.sql` (set_config ids, `set local role authenticated` + `request.jwt.claims`, `reset role` for RPC-only inserts).

- [ ] **Step 2 — run, expect FAIL:** `supabase test db` (screener objects missing).

- [ ] **Step 3 — enum migration** `20260720000200_screener_asset_kind.sql` (own file, no other statements — sidesteps the in-transaction ADD VALUE restriction; no repo precedent, so isolate it):
```sql
-- 20260720000200_screener_asset_kind.sql
-- INTENT: add 'screener' to asset_kind (Portal-2). Isolated migration so the new
-- enum value is committed before any later migration/DML uses it.
-- DESTRUCTIVE OPS (approved before apply): alter type add value. Forward-only + idempotent.
alter type public.asset_kind add value if not exists 'screener';
```

- [ ] **Step 4 — main migration** `20260720000300_screener_room.sql`:
```sql
-- 20260720000300_screener_room.sql
-- INTENT: Portal-2 screener room (design 2026-07-20-asset-portal-slice-2). Per-title
-- screener_source; generalize portal_links with a purpose discriminator to share the
-- Portal-1 OTP gate; append-only screener_view_events capture; RPCs for GC link creation,
-- service-role stream resolution (no rule-12 gate — pitch view), and the GC per-viewer summary.
-- DESTRUCTIVE OPS (approved before apply): create types/table; ALTER titles + portal_links
-- (+CHECK, drop NOT NULLs); functions; revokes. Forward-only + idempotent.

do $$ begin create type public.screener_source as enum ('master','dedicated');
exception when duplicate_object then null; end $$;
alter table public.titles
  add column if not exists screener_source public.screener_source not null default 'master';

do $$ begin create type public.portal_link_purpose as enum ('master_download','screener_view');
exception when duplicate_object then null; end $$;
alter table public.portal_links
  add column if not exists purpose  public.portal_link_purpose not null default 'master_download',
  add column if not exists title_id uuid references public.titles(id) on delete restrict;
alter table public.portal_links alter column delivery_id drop not null;
alter table public.portal_links alter column asset_id    drop not null;
alter table public.portal_links drop constraint if exists portal_links_purpose_shape;
alter table public.portal_links add constraint portal_links_purpose_shape check (
  (purpose = 'master_download' and delivery_id is not null and asset_id is not null and title_id is null)
  or (purpose = 'screener_view' and title_id is not null and delivery_id is null and asset_id is null)
);
create index if not exists portal_links_title_idx on public.portal_links (title_id);

do $$ begin create type public.screener_event as enum ('play','pause','seek','progress','ended');
exception when duplicate_object then null; end $$;
create table if not exists public.screener_view_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.portal_sessions(id) on delete restrict,
  link_id          uuid not null references public.portal_links(id)    on delete restrict,
  event_type       public.screener_event not null,
  position_seconds int  not null default 0,
  runtime_seconds  int,
  occurred_at      timestamptz not null default now()
);
create index if not exists screener_view_events_link_idx    on public.screener_view_events (link_id);
create index if not exists screener_view_events_session_idx on public.screener_view_events (session_id);

alter table public.screener_view_events enable row level security;
revoke all on public.screener_view_events from anon;
revoke insert, update, delete on public.screener_view_events from authenticated;
revoke update, delete on public.screener_view_events from service_role;  -- append-only (rule 5)
drop policy if exists screener_view_events_select on public.screener_view_events;
create policy screener_view_events_select on public.screener_view_events for select to authenticated
  using (public.is_gc_staff(auth.uid()));

-- create_screener_link (GC-only, screenable gate)
create or replace function public.create_screener_link(
  p_title_id uuid, p_token_hash text, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source public.screener_source; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select screener_source into v_source from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
  if v_source = 'dedicated' then
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'screener') then
      raise exception 'Screener source is set to dedicated but no screener has been uploaded';
    end if;
  else
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'master') then
      raise exception 'No master asset to screen';
    end if;
  end if;
  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  insert into public.portal_links (purpose, title_id, token_hash, created_by, expires_at)
  values ('screener_view', p_title_id, btrim(p_token_hash), auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_screener_link(uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_screener_link(uuid, text, timestamptz) to authenticated;

-- portal_resolve_screener (service-role only; NO rule-12 gate — pitch view)
create or replace function public.portal_resolve_screener(p_session_token_hash text)
  returns table(storage_key text, link_id uuid, session_id uuid, title_id uuid)
  language plpgsql security definer set search_path = public as $$
declare
  v_sess public.portal_sessions%rowtype; v_link public.portal_links%rowtype;
  v_source public.screener_source; v_key text;
begin
  select * into v_sess from public.portal_sessions
    where token_hash = p_session_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'Session expired or not found'; end if;
  select * into v_link from public.portal_links
    where id = v_sess.link_id and purpose = 'screener_view' and revoked_at is null and expires_at > now();
  if not found then raise exception 'Link expired or revoked'; end if;
  select screener_source into v_source from public.titles where id = v_link.title_id;
  if v_source = 'dedicated' then
    select a.storage_key into v_key from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'screener' order by a.created_at desc limit 1;
  else
    select a.storage_key into v_key from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'master' order by a.created_at desc limit 1;
  end if;
  if v_key is null then raise exception 'Screener source asset not found'; end if;
  return query select v_key, v_link.id, v_sess.id, v_link.title_id;
end; $$;
revoke execute on function public.portal_resolve_screener(text) from public, anon, authenticated;
grant  execute on function public.portal_resolve_screener(text) to service_role;

-- screener_engagement (GC-only read; derived on read, rule 4)
create or replace function public.screener_engagement(p_link_id uuid)
  returns table(session_id uuid, name text, company text, email text,
                watched_pct int, completed boolean, replays int, last_viewed timestamptz)
  language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.company, s.email,
         coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds), 0)), 0)::int,
         bool_or(e.event_type = 'ended')
           or coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds),0)),0) >= 95,
         greatest(count(*) filter (where e.event_type = 'ended') - 1, 0)::int,
         max(e.occurred_at)
  from public.portal_sessions s
  join public.screener_view_events e on e.session_id = s.id
  where e.link_id = p_link_id and public.is_gc_staff(auth.uid())
  group by s.id, s.name, s.company, s.email;
$$;
revoke execute on function public.screener_engagement(uuid) from public, anon;
grant  execute on function public.screener_engagement(uuid) to authenticated;
```

- [ ] **Step 5 — STOP for destructive-ops approval.** Show the founder both migration files; do not apply until approved.
- [ ] **Step 6 — apply + test:** founder runs `supabase db reset`; then `supabase test db` (all green incl. Portal-1's `portal_test.sql` still passing + new `screener_test.sql`).
- [ ] **Step 7 — regen types + typecheck:** `supabase gen types typescript --local > src/lib/supabase/database.types.ts`; `pnpm typecheck`.
- [ ] **Step 8 — commit.**

---

## Task 2 — `screener` asset kind wiring (TS)  *(WEIGHT: light — inline)*

**Files:** `api/assets/initiate/route.ts`, `api/assets/complete/route.ts`, `titles/[id]/asset-upload.tsx`, `titles/[id]/page.tsx`.

- [ ] Add `"screener"` to the kind zod enum in both asset routes: `z.enum(["master","caption","artwork","screener"])`.
- [ ] `asset-upload.tsx`: `type Kind = "master" | "caption" | "artwork" | "screener";` and add `<option value="screener">Screener</option>`.
- [ ] `titles/[id]/page.tsx`: `ASSET_KIND_LABELS` += `screener: "Screener"`.
- [ ] `pnpm typecheck && pnpm build`. Commit.

---

## Task 3 — Client `screener_source` control  *(WEIGHT: light — inline)*

**Files:** `titles/[id]/actions.ts` (add action), `titles/[id]/page.tsx` (render control).

- [ ] `actions.ts` — add `setScreenerSource(input: { titleId: string; source: "master" | "dedicated" })`: user-JWT `createClient()`, `getUser` guard, `supabase.from("titles").update({ screener_source: input.source }).eq("id", titleId)` (RLS: `member_can(operate)` — confirm titles UPDATE policy allows the owner; if titles has no direct UPDATE policy, add a tiny SECURITY DEFINER `set_screener_source` RPC instead, `member_can(...,'operate')`-gated). `revalidatePath`.
  > VERIFY during implementation: whether `titles` allows an owner UPDATE under RLS. If not (RPC-only), write `set_screener_source(p_title_id, p_source)` SECURITY DEFINER gated on `member_can(auth.uid(), org_id, 'operate')` and call that instead. Match whichever pattern `titles` already uses for client writes.
- [ ] `page.tsx` — a small control (radio/select) showing current `screener_source`, calling the action; informational line when `master`: copy from `PORTAL_COPY`/a title-copy module ("No separate screener? Your master will be used for screenings."). Tokens only.
- [ ] `pnpm typecheck && pnpm build`. Commit.

---

## Task 4 — Screener resolve + event routes  *(WEIGHT: heavy — fresh subagent + full review)*

**Files:** create `src/app/api/portal/screener/route.ts`, `src/app/api/portal/screener-event/route.ts`.

**Interfaces consumed:** `createAdminClient`, `hashToken`/`PORTAL` (`@/lib/portal`), `signAssetUrl` (`@/lib/cloudfront`), `cookies`, RPC `portal_resolve_screener`.

- [ ] **`/api/portal/screener` (POST, no body):** mirror `download/route.ts` but for the screener — read `PORTAL.sessionCookie`, `hashToken`, call `portal_resolve_screener`, `signAssetUrl(row.storage_key)`, return `{ type: "progressive", url }`; no cookie → 401; RPC error/empty → 403; sign throw → 409 "File is being prepared". (This route does NOT log — playback is logged via the event route. The room-entry audit already happened at verify-otp.)
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { signAssetUrl } from "@/lib/cloudfront";

export async function POST() {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  let url: string;
  try { url = signAssetUrl(row.storage_key); }
  catch { return NextResponse.json({ error: "File is being prepared" }, { status: 409 }); }
  return NextResponse.json({ type: "progressive", url });
}
```
- [ ] **`/api/portal/screener-event` (POST):** zod `{ event_type: z.enum(["play","pause","seek","progress","ended"]), position_seconds: z.number().int().min(0).max(200000), runtime_seconds: z.number().int().min(0).max(200000).nullable().optional() }`. Read the session cookie → resolve the session to `(session_id, link_id)` via `portal_resolve_screener` (which validates the session + link and is the authorization check) → insert one `screener_view_events` row (service-role). No session/invalid → 401/403. Check the insert error and return 500 on failure (provenance-ish, but low-stakes analytics — 500 is fine; do not silently swallow).
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";

const Body = z.object({
  event_type: z.enum(["play","pause","seek","progress","ended"]),
  position_seconds: z.number().int().min(0).max(200000),
  runtime_seconds: z.number().int().min(0).max(200000).nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { error: insErr } = await admin.from("screener_view_events").insert({
    session_id: row.session_id, link_id: row.link_id,
    event_type: parsed.data.event_type, position_seconds: parsed.data.position_seconds,
    runtime_seconds: parsed.data.runtime_seconds ?? null,
  });
  if (insErr) return NextResponse.json({ error: "Could not record" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```
- [ ] `pnpm typecheck`. Commit.

---

## Task 5 — Instrumented player + public-page `purpose` branch  *(WEIGHT: medium — subagent + review)*

**Files:** create `src/app/portal/[token]/screener-room.tsx`; modify `src/app/portal/[token]/page.tsx` and `src/lib/portal.ts` (copy).

- [ ] `portal.ts` — extend `PORTAL_COPY` with screener strings (e.g. `screenerHeading`, `screenerIntro`); no banned words.
- [ ] `page.tsx` — extend the link query to select `purpose, title_id`; for `screener_view`, resolve title display info (title + logline/runtime from `title_metadata`, read via the admin client already in use) and render `<ScreenerRoom token title info={...} />` after the same identity→code gate; keep the existing `master_download` download branch unchanged. (The identity→code stages live in `portal-flow.tsx`; factor the shared gate so both the download flow and the screener room sit behind it — simplest: `portal-flow.tsx` accepts a `mode`/children for the post-verified stage, OR the page renders the gate then swaps in the room. Choose the smaller diff; do not duplicate the gate.)
- [ ] `screener-room.tsx` (`"use client"`) — an instrumented `<video>`: on mount fetch `/api/portal/screener` → set `src`; attach listeners (`play`,`pause`,`seeked`,`ended`) + a `timeupdate`-throttled `progress` heartbeat (~every 10s) → POST to `/api/portal/screener-event` with `event_type`, `Math.floor(currentTime)`, `Math.floor(duration)`. `controls` on, `controlsList="nodownload"`, `disablePictureInPicture` optional (view-only is best-effort; note no DRM). Curated title info around the player from props. Tokens only.
  > Player is a plain instrumented `<video>` for progressive MP4; the ABR seam (Shaka/dash.js) swaps here later behind the unchanged `/api/portal/screener` response shape.
- [ ] `pnpm typecheck && pnpm build`; smoke: an invalid token still shows the expired card; a `master_download` link still shows the download flow (no regression). Commit.

---

## Task 6 — GC screener panel on `/gc/review`  *(WEIGHT: medium — subagent + review)*

**Files:** `src/app/gc/review/actions.ts` (+2 actions), `src/app/gc/review/page.tsx` (load + render), create `src/app/gc/review/screener-panel.tsx`.

- [ ] `actions.ts` — `createScreenerLink({ titleId })`: user-JWT client, `generateToken()`, `supabase.rpc("create_screener_link", { p_title_id, p_token_hash: hashToken(token) })`, return `{ url: \`${PORTAL_BASE_URL ?? ""}/portal/${token}\` }` (raw token shown once). `revokeScreenerLink({ linkId })` → `supabase.rpc("revoke_portal_link", { p_link_id })` (reused). Mirror the shape of Portal-1's `createPortalLink`/`revokePortalLink` in `gc/deliveries/actions.ts`.
- [ ] `page.tsx` — for each reviewed title, load its `screener_view`-purpose `portal_links` and, per link, `supabase.rpc("screener_engagement", { p_link_id })`; render `<ScreenerPanel title={...} links={...} engagement={...} />`. (GC RLS permits these reads.)
- [ ] `screener-panel.tsx` (`"use client"`) — "Screen this title": Generate link (shows URL to copy), active links + Revoke, and the per-viewer summary table (viewer, % watched, completed, replays, last-viewed). Real primitive props (`InlineNotice` tone `info|error`); tokens only; copy concise per the existing `/gc/review` convention.
- [ ] `pnpm typecheck && pnpm build`. Commit.

---

## Task 7 — Verification + docs  *(WEIGHT: light — inline; final whole-branch review after)*

- [ ] Full suite: `supabase test db` (Portal-1 + screener green), `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] `/leak-check` — confirm no CloudFront/Resend/service-role material in the client bundle (the screener room is a client component that only `fetch`es the routes — verify it imports no server-only/admin modules).
- [ ] Append a "screener room" section to `docs/infra/asset-portal-setup.md` (same CloudFront/S3 infra; screeners stay on S3 Standard — no new provisioning beyond Portal-1) + the manual e2e checklist: client sets `dedicated` + uploads a screener → GC `/gc/review` generates a screener link → logged-out browser → identity → code → screener plays (streamed, not downloaded) → scrub/pause/finish → GC summary shows that viewer's % watched + completion; revoke kills the link; a `master`-source title screens the master.
- [ ] Commit.

## Self-Review (against the spec)

- **Coverage:** screener asset kind (T1 enum, T2 wiring) · `screener_source` + gate (T1 RPC, T3 UI) · `portal_links` generalization + shared gate (T1) · `screener_view_events` append-only (T1) · resolve/event routes (T4) · instrumented player + purpose branch (T5) · GC panel + per-viewer summary (T6) · no rights gate (T1 `portal_resolve_screener`) · reuse of `request-otp`/`verify-otp`/`revoke_portal_link`/signer/gate (T4–T6) · pgTAP+manual (T1,T7). Deferred seams (heatmap/ABR/DRM/Glacier) documented, not built.
- **Type consistency:** `hashToken`/`generateToken`/`PORTAL`/`signAssetUrl`/`createAdminClient` reused with Portal-1 signatures; `portal_resolve_screener` return columns (`storage_key`,`link_id`,`session_id`,`title_id`) match T4's usage; `create_screener_link(uuid,text,timestamptz)` matches T6's call (2 args + defaulted 3rd, per the `default null` gotcha).
- **Open verification flagged inline:** whether `titles` allows an owner UPDATE under RLS (T3) — resolve to a direct update or a definer RPC during implementation.
