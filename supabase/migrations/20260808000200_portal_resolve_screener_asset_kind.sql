-- 20260808000200_portal_resolve_screener_asset_kind.sql
--
-- INTENT: close the portal screener TOCTOU between portal_resolve_screener and a
-- separate titles.screener_source re-read (HANDOFF architectural debt; Option D
-- follow-up 2026-08-08).
--
-- Race (before this migration):
--   1) RPC resolves a MASTER storage_key while screener_source = 'master'
--   2) Concurrent register_transcode_output flips title to 'dedicated'
--   3) Route re-reads titles.screener_source = 'dedicated' and signs the already-
--      resolved MASTER key — violating "portal playback must be the dedicated screener"
--
-- Fix: return the resolved asset's kind from the SAME SELECT that produces
-- storage_key. Callers authorize on that evidence; a later title flip cannot make
-- a master key acceptable.
--
-- RETURNS TABLE shape changes → CREATE OR REPLACE cannot alter OUT columns.
-- DROP + CREATE (same argument types); re-apply EXECUTE grants. Body resolution
-- logic unchanged except capturing kind alongside storage_key.
--
-- DESTRUCTIVE OPS: DROP FUNCTION portal_resolve_screener(text) + recreate with
-- one added OUT column (asset_kind). No table/data change. Do not apply from an
-- agent.

drop function if exists public.portal_resolve_screener(text);

create function public.portal_resolve_screener(p_session_token_hash text)
  returns table(
    storage_key text,
    link_id uuid,
    session_id uuid,
    title_id uuid,
    asset_kind public.asset_kind
  )
  language plpgsql security definer set search_path = public as $$
declare
  v_sess public.portal_sessions%rowtype;
  v_link public.portal_links%rowtype;
  v_source public.screener_source;
  v_key text;
  v_kind public.asset_kind;
begin
  select * into v_sess from public.portal_sessions
    where token_hash = p_session_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'Session expired or not found'; end if;
  select * into v_link from public.portal_links
    where id = v_sess.link_id and purpose = 'screener_view'
      and revoked_at is null and expires_at > now();
  if not found then raise exception 'Link expired or revoked'; end if;
  select screener_source into v_source from public.titles where id = v_link.title_id;
  if v_source = 'dedicated' then
    select a.storage_key, a.kind into v_key, v_kind from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'screener'
      order by a.created_at desc limit 1;
  else
    select a.storage_key, a.kind into v_key, v_kind from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'master'
      order by a.created_at desc limit 1;
  end if;
  if v_key is null or v_kind is null then
    raise exception 'Screener source asset not found';
  end if;
  return query select v_key, v_link.id, v_sess.id, v_link.title_id, v_kind;
end; $$;

revoke execute on function public.portal_resolve_screener(text) from public, anon, authenticated;
grant  execute on function public.portal_resolve_screener(text) to service_role;
