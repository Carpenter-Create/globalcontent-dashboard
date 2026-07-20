-- ============================================================================
-- 20260720000600_findings.sql
--
-- INTENT: the one findings store (domain-spec §19; design 2026-07-20-findings-
-- attention-queue). Validator findings only in v1 (AI findings, health score, Globee
-- deferred). Persisted + reconciled (not computed on read) so the attention queue and,
-- later, Globee read the SAME rows. First table to carry the rule-4 provenance triple
-- (source_refs + logic_version + derived_at). Written only via reconcile_title_findings
-- (SECURITY DEFINER, operate/GC); read via my_findings + RLS. sender = gc_support (the
-- institution's push channel, §20).
--
-- DESTRUCTIVE OPS (approved before apply): create 4 enums + table + trigger + 2 functions;
-- revokes. Forward-only + idempotent where possible.
-- ============================================================================

do $$ begin create type public.finding_source   as enum ('validator','ai');
exception when duplicate_object then null; end $$;
do $$ begin create type public.finding_sender   as enum ('gc_support','globee');
exception when duplicate_object then null; end $$;
do $$ begin create type public.finding_severity as enum ('high','low');
exception when duplicate_object then null; end $$;
do $$ begin create type public.finding_status   as enum ('open','resolved');
exception when duplicate_object then null; end $$;

create table if not exists public.findings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete restrict,
  entity_type   text not null,                          -- 'title' in v1
  entity_id     uuid not null,
  code          text not null,                          -- e.g. 'metadata.missing.synopsis'
  source        public.finding_source   not null,
  sender        public.finding_sender   not null default 'gc_support',
  severity      public.finding_severity not null,
  status        public.finding_status   not null default 'open',
  message       text not null,
  source_refs   jsonb not null,                         -- rule 4: {title_id, field, tier}
  logic_version text not null,                           -- rule 4
  derived_at    timestamptz not null default now(),     -- rule 4
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (entity_type, entity_id, code, source)
);
create index if not exists findings_org_status_idx on public.findings (org_id, status);
create index if not exists findings_entity_idx     on public.findings (entity_type, entity_id);
create index if not exists findings_status_idx      on public.findings (status);

drop trigger if exists audit_findings on public.findings;
create trigger audit_findings after insert or update or delete on public.findings
  for each row execute function public.tg_audit();

alter table public.findings enable row level security;
revoke all on public.findings from anon;
revoke insert, update, delete on public.findings from authenticated;  -- RPC-only writes
drop policy if exists findings_select on public.findings;
create policy findings_select on public.findings for select to authenticated
  using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'));

-- ---- reconcile_title_findings: upsert current validator findings + auto-resolve gone ----
-- p_findings = jsonb array of {code, severity, message, field, tier}. Only touches
-- source='validator' rows for the title, so future AI findings are never disturbed.
create or replace function public.reconcile_title_findings(
  p_org_id uuid, p_title_id uuid, p_findings jsonb, p_logic_version text
) returns void language plpgsql security definer set search_path = public as $$
declare
  f jsonb;
  v_codes text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), p_org_id, 'operate')) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.titles where id = p_title_id and org_id = p_org_id) then
    raise exception 'Title not found in this organization';
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_codes := array_append(v_codes, f->>'code');
    insert into public.findings
      (org_id, entity_type, entity_id, code, source, sender, severity, message,
       source_refs, logic_version, derived_at, status, resolved_at)
    values
      (p_org_id, 'title', p_title_id, f->>'code', 'validator', 'gc_support',
       (f->>'severity')::public.finding_severity, f->>'message',
       jsonb_build_object('title_id', p_title_id, 'field', f->>'field', 'tier', f->>'tier'),
       p_logic_version, now(), 'open', null)
    on conflict (entity_type, entity_id, code, source) do update
      set status = 'open', resolved_at = null,
          severity = excluded.severity, message = excluded.message,
          source_refs = excluded.source_refs, logic_version = excluded.logic_version,
          derived_at = excluded.derived_at;
  end loop;

  -- auto-resolve validator findings for this title that are no longer present
  update public.findings
    set status = 'resolved', resolved_at = now()
    where entity_type = 'title' and entity_id = p_title_id and source = 'validator'
      and status = 'open' and not (code = any (v_codes));
end; $$;
revoke execute on function public.reconcile_title_findings(uuid, uuid, jsonb, text) from public, anon;
grant  execute on function public.reconcile_title_findings(uuid, uuid, jsonb, text) to authenticated;

-- ---- my_findings: the caller's own open findings (client attention queue) ----
create or replace function public.my_findings()
  returns setof public.findings language sql stable security definer set search_path = public as $$
  select * from public.findings
  where status = 'open' and public.member_can(auth.uid(), org_id, 'view')
  order by severity, created_at;  -- enum is ('high','low') → ascending puts high first
$$;
revoke execute on function public.my_findings() from public, anon;
grant  execute on function public.my_findings() to authenticated;
