# Notifications (in-app, lifecycle) — Implementation Plan

**Goal:** In-app §20 GC-Support push: `notifications` + `notification_reads` (per-user unread) + RPCs; created on title rejection + delivery transitions; inbox at `/messages` + a nav unread badge.

**Branch:** `notifications-inapp` off `main`. No new env/deps. Execute lean: migration founder-approved; wiring + surfaces inline; review + PR at end.

## Global Constraints
- pnpm. RLS is authz (read = `is_gc_staff OR member_can(view)`; notifications writes RPC-only). `tg_audit` on notifications. `sender='gc_support'` v1 (Globee never pushes). Notification body **says why** (§19). create_notification is GC-only; both triggers best-effort (a notify failure must not fail the GC action). Copy in `lib/`; tokens only; parent voice; no banned words. Destructive-ops approval gate on the migration. Migration ts `20260720000700`.

## Task 1 — Migration + RPCs + pgTAP  *(heavy — destructive-ops STOP)*
**Files:** `supabase/migrations/20260720000700_notifications.sql`, `supabase/tests/notifications_test.sql`, regen `database.types.ts`.
- Enums `notification_kind ('title_rejected','delivery_update')`, `notification_sender ('gc_support','globee')`.
- `notifications` + `notification_reads` per the spec data model; index `(org_id, created_at desc)`; `tg_audit` on `notifications`.
- RLS: `notifications` — revoke all from anon; revoke insert/update/delete from authenticated; SELECT `is_gc_staff or member_can(org_id,'view')`. `notification_reads` — enable rls; revoke all from anon; SELECT + INSERT policy `user_id = auth.uid()`; revoke update/delete from authenticated (write via RPC).
- **`create_notification(p_org_id uuid, p_kind public.notification_kind, p_title text, p_body text, p_source_refs jsonb) returns uuid`** SECURITY DEFINER: `is_gc_staff` gate; insert (`sender='gc_support'`, `created_by=auth.uid()`); return id. `revoke … from public,anon; grant … to authenticated`.
- **`mark_notifications_read(p_ids uuid[]) returns void`** SECURITY DEFINER: for each id where the caller can SELECT the notification (RLS-visible → check via `member_can(view) or is_gc_staff` against its org), `insert into notification_reads (notification_id, user_id) values (id, auth.uid()) on conflict do nothing`.
- **`my_notifications() returns table(id uuid, org_id uuid, kind public.notification_kind, title text, body text, source_refs jsonb, created_at timestamptz, unread boolean)`** SECURITY DEFINER SQL: `select n.*, not exists(select 1 from notification_reads r where r.notification_id=n.id and r.user_id=auth.uid()) as unread from notifications n where member_can(auth.uid(), n.org_id,'view') order by n.created_at desc`.
- **`my_unread_count() returns int`** SECURITY DEFINER SQL: count of `my_notifications` where unread (or the equivalent not-exists).
- `grant execute` to authenticated on the three caller RPCs; `create_notification` too (GC-gated inside).
- pgTAP `notifications_test.sql`: create GC-only (client `throws_ok 'Not authorized'`, gc `lives_ok`); RLS (org B owner sees 0 of org A's; anon revoked; direct insert as authenticated denied); `mark_notifications_read` sets a read row for the caller only + flips `my_notifications.unread`; `my_unread_count` decrements; a second user in org A still sees it unread (per-user).
- STOP for founder approval → apply → `supabase test db` → regen types → commit.

## Task 2 — Trigger wiring  *(inline)*
**Files:** `src/app/gc/review/actions.ts`, `src/app/gc/deliveries/actions.ts`.
- **review reject:** in the reject path, after `review_title` succeeds, read the title (`title`, `org_id`) and call `supabase.rpc("create_notification", { p_org_id, p_kind:"title_rejected", p_title:"Title returned for revision", p_body:`"${titleName}" was returned for revision: ${reason}`, p_source_refs:{ title_id, reason } })`. Best-effort try/catch.
- **delivery status:** in `setDeliveryStatus`, after `set_delivery_status` succeeds, read the delivery's title name + vendor name + org_id (`deliveries` join, GC RLS allows) and `create_notification({ p_kind:"delivery_update", p_title:"Delivery update", p_body:`"${titleName}" is now ${status} on ${vendorName}`, p_source_refs:{ delivery_id, title_id, status } })`. Best-effort try/catch.
- `pnpm typecheck && pnpm build`; commit.

## Task 3 — Inbox + nav badge  *(inline)*
**Files:** `src/app/(app)/messages/page.tsx` (replace stub), create `src/lib/notifications.ts`; `src/lib/nav.ts` + `src/components/chrome/side-nav.tsx` + `src/components/chrome/app-shell.tsx` (unread badge).
- `src/lib/notifications.ts`: `NOTIFICATION_KIND_LABEL` + empty-state copy.
- **`/messages`:** `my_notifications()` → list (Card per notice: title, body, kind label, relative time; unread emphasized via a token accent/dot). A `MarkAllRead` client component calling a `markAllRead` server action (`mark_notifications_read` with the unread ids) → `revalidatePath('/messages')`. Empty → "No messages yet."
- **Nav badge:** app-shell (server) reads `my_unread_count()`, passes to `SideNav`; extend `SideNav` to render a small count next to the item whose href is `/messages` (tokens only). Keep `NavItem` as-is; pass a `counts: Record<string, number>` prop or just the messages count.
- `pnpm typecheck && pnpm build`; commit.

## Task 4 — Verify + review + PR  *(inline)*
- Full suite: `supabase test db`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- leak-check (no secrets; sanity).
- Whole-branch review (opus); fix Critical/Important; PR off `main`.

## Self-review
Covers §20 in-app push v1: store + per-user unread (T1), lifecycle triggers that say why (T2), inbox + badge (T3). Deferred seams (email/findings/system/Globee) shaped not built. Types: `my_notifications` return columns match the inbox render; `create_notification` arg types match both call sites.
