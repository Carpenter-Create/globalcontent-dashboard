-- ============================================================================
-- 20260819000100_ask_globee_conversations.sql
--
-- INTENT: persist Ask Globee threads so Pro/Premium HISTORY and follow-ups are
-- real org-scoped rows, not a ?q= rewrite that wipes prior turns. Conversations
-- are member-created catalog Q&A (title, pin, hard-delete). Messages are the
-- user prompt and the grounded Globee answer (lead / follow / thumbs).
--
-- AUTHORIZATION. SELECT and writes use member_can(auth.uid(), org_id, 'view').
-- That is the existing capability other client-created *member* rows use when
-- every org member may act (notification_reads; catalog read). 'operate' is the
-- capability for outbound catalog mutation (titles, source_documents, screeners)
-- and would lock viewer / legal / accountant out of a tier-gated Messages
-- surface. Tier (Access vs Pro/Premium) is enforced in the app, not here.
-- GC staff without membership do not see another org's threads — the brief is
-- member_can view, not is_gc_staff.
--
-- HARD-DELETE. Founder-authorized exception to golden rule 2 for this store
-- only: Delete conversation is permanent. Messages CASCADE from the parent so
-- a deleted thread leaves no orphan turns. audit_log still records the delete.
--
-- DESTRUCTIVE OPS (approved in the founder brief; do NOT apply to production
-- from this PR): create 2 enums + 2 tables + indexes + grants + RLS + audit
-- triggers + updated_at / touch triggers. Forward-only + idempotent where
-- possible. ROLLBACK: drop the two tables, then the two enums.
-- ============================================================================

do $$ begin create type public.conversation_role as enum ('user', 'globee');
exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_thumb as enum ('up', 'down');
exception when duplicate_object then null; end $$;

create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete restrict,
  title       text not null,
  pinned_at   timestamptz,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint conversations_title_nonempty check (char_length(btrim(title)) > 0)
);
create index if not exists conversations_org_pin_updated_idx
  on public.conversations (org_id, pinned_at desc nulls last, updated_at desc);

create table if not exists public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete restrict,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  role             public.conversation_role not null,
  body             text not null,
  lead             text,
  follow           text,
  thumbs           public.conversation_thumb,
  created_at       timestamptz not null default now(),
  constraint conversation_messages_body_nonempty check (char_length(btrim(body)) > 0),
  constraint conversation_messages_globee_lead check (
    role <> 'globee' or (lead is not null and char_length(btrim(lead)) > 0)
  ),
  constraint conversation_messages_user_fields check (
    role <> 'user' or (lead is null and follow is null and thumbs is null)
  )
);
create index if not exists conversation_messages_thread_idx
  on public.conversation_messages (conversation_id, created_at);
create index if not exists conversation_messages_org_idx
  on public.conversation_messages (org_id, created_at);

drop trigger if exists audit_conversations on public.conversations;
create trigger audit_conversations after insert or update or delete on public.conversations
  for each row execute function public.tg_audit();

drop trigger if exists audit_conversation_messages on public.conversation_messages;
create trigger audit_conversation_messages after insert or update or delete on public.conversation_messages
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_conversations on public.conversations;
create trigger set_updated_at_conversations before update on public.conversations
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_touch_conversation()
  returns trigger language plpgsql set search_path = public as $$
begin
  update public.conversations
    set updated_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists touch_conversation_on_message on public.conversation_messages;
create trigger touch_conversation_on_message after insert on public.conversation_messages
  for each row execute function public.tg_touch_conversation();

revoke all on public.conversations from anon, authenticated;
revoke all on public.conversation_messages from anon, authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversation_messages to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert to authenticated
  with check (public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'))
  with check (public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

-- RLS via the parent conversation's org_id (denormalized on the row for audit
-- + WITH CHECK that the caller cannot point a message at a foreign org).
drop policy if exists conversation_messages_select on public.conversation_messages;
create policy conversation_messages_select on public.conversation_messages for select to authenticated
  using (
    public.member_can(auth.uid(), org_id, 'view')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.org_id = org_id
    )
  );

drop policy if exists conversation_messages_insert on public.conversation_messages;
create policy conversation_messages_insert on public.conversation_messages for insert to authenticated
  with check (
    public.member_can(auth.uid(), org_id, 'view')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.org_id = org_id
    )
  );

drop policy if exists conversation_messages_update on public.conversation_messages;
create policy conversation_messages_update on public.conversation_messages for update to authenticated
  using (
    public.member_can(auth.uid(), org_id, 'view')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.org_id = org_id
    )
  )
  with check (
    public.member_can(auth.uid(), org_id, 'view')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.org_id = org_id
    )
  );

drop policy if exists conversation_messages_delete on public.conversation_messages;
create policy conversation_messages_delete on public.conversation_messages for delete to authenticated
  using (
    public.member_can(auth.uid(), org_id, 'view')
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.org_id = org_id
    )
  );
