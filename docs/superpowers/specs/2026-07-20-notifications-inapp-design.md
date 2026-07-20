# Notifications (in-app, lifecycle) — design

> Status: design pending approval. The §20 **Global Content Support** push channel, in-app: GC actions
> the client must know about (title rejection, delivery-status transitions) create a notification that
> **says why** (§19), shown in an inbox with per-user unread. v1 = **in-app + lifecycle triggers only**;
> **email** (Resend) and **findings-/system-driven** notifications are clean deferred seams. Independent
> of the findings PR and the portal stack — branches off `main`.

## Context

§20: two channels — **GC Support** (push only, institution → client, "payment failed, master rejected,
metadata gaps, tier changing, deadlines, expiry"; parent voice) and **Ask Globee** (pull only,
deferred). **"Globee never initiates — push belongs to the institution."** Findings *and* notifications
carry a **`sender`** (`gc_support | globee`). §19: **"the notification must say why"**; **"notify on
material actionable change, not score deltas."** §13: delivery transitions notify email + in-app,
sender GC Support. Email is a **v1 dependency** (port-inventory) but has no transport on `main` (Resend
lives only on the unmerged portal branches; local dev is Inbucket-only) — so v1 here is **in-app**, email
follows once Resend merges.

v1 triggers are **lifecycle events the client didn't cause** — the clean, non-redundant pushes whose
sources already exist on `main`: **title rejection** (`review_title` → reject) and **delivery-status
transitions** (`set_delivery_status`). Findings-driven pushes wait (the attention queue already surfaces
findings, and the canonical field list can't change yet, so there's nothing systemic to push). System
events (payment/tier/expiry) need Stripe-webhook + cron (§21.8 open) — deferred.

## Scope

**In:**
- **`notifications` table** — org-scoped, provenance-carrying: `kind` (enum `title_rejected |
  delivery_update`), `sender` (`notification_sender` enum `gc_support|globee`, default `gc_support`),
  `title`, `body` ("says why"), `source_refs jsonb` (title_id / delivery_id / reason / status),
  `created_by`, `created_at`. RLS read = `is_gc_staff OR member_can(view)`; writes RPC-only; `tg_audit`.
- **`notification_reads`** — `(notification_id, user_id, read_at)`, unique per pair. **Per-user unread**
  (org-scoped notice, per-member read state — correct with >1 member).
- **RPCs:** `create_notification` (GC-only), `mark_notifications_read(uuid[])` (authenticated, own reads
  only), `my_notifications()` (caller's org notifications newest-first + computed `unread`),
  `my_unread_count()` (for the nav badge).
- **Triggers (app layer):** GC review action creates `title_rejected` on reject (body carries the
  reason); GC delivery-status action creates `delivery_update` on each transition (body carries vendor +
  new status).
- **Surfaces:** `/messages` inbox (replace stub) + a nav **unread indicator** (extend `NavItem` +
  `SideNav`, count from `my_unread_count`).
- pgTAP + manual.

**Out (seams — designed, not built):**
- **Email** — `create_notification` gains a send step reusing the portal's `@/lib/email` (Resend) once
  it's on `main`; needs SMTP/domain provisioning too.
- **Findings-driven** notifications — needs `reconcile_title_findings` to return newly-created findings
  (a small change on the findings branch); the `kind` enum extends with a `metadata_gap` value.
- **System events** (payment failed, tier change, expiry, deadlines) — Stripe webhook + a cron (§21.8
  dunning cadence is an open founder decision).
- **Globee escalation inbox** (§20) and term-change notice (§5, needs the terms-write path).

## Key decisions

- **Lifecycle triggers only in v1** (title rejection + delivery transitions) — "material actionable
  change," non-redundant with the attention queue; both sources exist on `main`. Founder-confirmed.
- **In-app now, email next** — email is blocked on Resend (unmerged) + provisioning; the notification
  record + inbox is the buildable core. Founder-confirmed.
- **Per-user read state** (`notification_reads`) — org-wide "read" is wrong with multiple members.
- **`create_notification` is GC-only** — both v1 triggers are GC actions; broaden when a client- or
  cron-initiated notice (term change, lapse) lands.
- **`sender='gc_support'`** always in v1 (Globee never pushes, §20).
- **Own `notification_sender` enum** (not shared with findings' `finding_sender` — that type lives on a
  different branch; both merge cleanly as separate types for separate tables).

## Data model

```sql
do $$ begin create type public.notification_kind   as enum ('title_rejected','delivery_update');
exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_sender as enum ('gc_support','globee');
exception when duplicate_object then null; end $$;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete restrict,
  kind        public.notification_kind not null,
  sender      public.notification_sender not null default 'gc_support',
  title       text not null,
  body        text not null,               -- "says why" (§19)
  source_refs jsonb not null,              -- {title_id?, delivery_id?, reason?, status?}
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on public.notifications (org_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete restrict,
  user_id         uuid not null references auth.users(id)          on delete restrict,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
```
- **RLS:** `notifications` — `revoke all from anon`; `revoke insert,update,delete from authenticated`
  (RPC-only); SELECT `is_gc_staff OR member_can(org_id,'view')`; `tg_audit`. `notification_reads` —
  `revoke all from anon`; SELECT/INSERT own rows (`user_id = auth.uid()`) via policy, UPDATE/DELETE
  revoked; write path is `mark_notifications_read` (SECURITY DEFINER) so a user can only mark
  notifications they can see. (Reads carry no org secret; a per-user read row is innocuous.)

## RPCs

- **`create_notification(p_org_id, p_kind, p_title, p_body, p_source_refs) returns uuid`** — SECURITY
  DEFINER, `is_gc_staff` only. Inserts a `gc_support` notice, `created_by = auth.uid()`.
- **`mark_notifications_read(p_ids uuid[]) returns void`** — SECURITY DEFINER, authenticated; for each
  id the caller can SELECT (RLS-visible), upsert a `notification_reads(id, auth.uid())` row.
- **`my_notifications() returns table(... , unread boolean)`** — SECURITY DEFINER; caller's org
  notifications (via `member_can(view)`), `unread = not exists(read row for auth.uid())`, newest first.
- **`my_unread_count() returns int`** — count of the caller's unread (drives the nav badge).

## Triggers (app layer — one caller each)

- **`src/app/gc/review/actions.ts`** — after `review_title(..., 'reject', reason)` succeeds:
  `create_notification(org, 'title_rejected', "'<title>' was returned for revision",
  body=reason-bearing, source_refs={title_id, reason})`. (Read the title's name + org for the message.)
- **`src/app/gc/deliveries/actions.ts`** (`setDeliveryStatus`) — after success:
  `create_notification(org, 'delivery_update', "'<title>' is now <status> on <vendor>",
  source_refs={delivery_id, title_id, status})`. Best-effort (a notify failure must not fail the GC
  action).

## Surfaces

- **`/messages`** (replace stub): `my_notifications()` list, newest first, unread emphasized; a "Mark
  all read" (calls `mark_notifications_read` with the visible unread ids) — or mark-on-view. Copy in
  `src/lib/notifications.ts` (kind labels, empty state). Tokens only; parent voice, no banned words.
- **Nav unread badge:** extend `NavItem` with an optional count source; the app shell reads
  `my_unread_count()` and `SideNav` renders a small count on **Messages**. Minimal.

## Verification

- **pgTAP:** `create_notification` GC-only (client denied); RLS org-scoping (org B can't see org A's
  notices; anon denied; direct writes revoked); `mark_notifications_read` marks only the caller's read
  state and only for visible notices; `my_notifications` unread flips after marking; `my_unread_count`.
- **Manual:** GC rejects a title → the client org sees a `title_rejected` notice with the reason + an
  unread badge; reading clears it; GC advances a delivery → a `delivery_update` notice appears.

## Seams left clean

Email = a send step in `create_notification` (reuse `@/lib/email` post-portal-merge). Findings-driven =
extend `notification_kind` + have reconcile return new findings. System events = Stripe webhook + cron.
The `kind` enum + `source_refs` generalize to any future notice; `sender` is ready for Globee (which
never pushes, so it stays `gc_support` in practice).

## Dependency & branching

Off `main` — independent of #17 (findings) and the portal stack. Migration `20260720000700` (after the
portal `...100–500` + findings `...600`) so order stays monotonic whichever merges first; no
dependency/name collision (distinct tables/enums). No new env/deps.
