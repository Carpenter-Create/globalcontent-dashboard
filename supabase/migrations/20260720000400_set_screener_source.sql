-- 20260720000400_set_screener_source.sql
-- INTENT: client sets a title's screener_source (master|dedicated). titles is
-- RPC-only-write (no authenticated UPDATE policy), so this SECURITY DEFINER RPC is
-- the write path, gated on member_can(...,'operate') — the same capability that
-- governs asset upload / submit_title. (Portal-2, design 2026-07-20-slice-2.)
-- DESTRUCTIVE OPS (approved before apply): create function + revoke/grant execute.
-- Forward-only + idempotent.

create or replace function public.set_screener_source(
  p_title_id uuid, p_source public.screener_source
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select org_id into v_org from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
  if not public.member_can(auth.uid(), v_org, 'operate') then
    raise exception 'Not authorized to edit this title';
  end if;
  update public.titles set screener_source = p_source where id = p_title_id;
end; $$;
revoke execute on function public.set_screener_source(uuid, public.screener_source) from public, anon;
grant  execute on function public.set_screener_source(uuid, public.screener_source) to authenticated;
