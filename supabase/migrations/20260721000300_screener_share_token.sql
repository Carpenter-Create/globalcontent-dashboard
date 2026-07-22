-- 20260721000300_screener_share_token.sql
--
-- INTENT: screener share links become ONE reusable link per title that GC can copy at any
-- time — not a fresh link minted on every click (which piled up duplicate "Active" rows and
-- gave no way to re-copy a link already sent). To rebuild the URL on later page loads we must
-- store the raw token, so:
--   1. portal_links gets a nullable share_token, populated for screener_view links ONLY.
--   2. create_screener_link takes p_share_token and, before minting, revokes any existing live
--      screener_view link for the title (single-active model; the revoke IS the "reset" — the
--      previously-shared URL stops resolving).
--
-- SECURITY POSTURE (deliberate, scoped): master_download links stay hash-only — their token,
-- post-OTP, yields the crown-jewel master. A screener token yields a view-only, no-download,
-- no-DRM stream still gated by the emailed OTP (docs/infra/asset-portal-setup.md calls the
-- screener "capturable in principle"), so the real gate is the OTP, not the URL token. Storing
-- it for screener_view links only is consistent with that lower bar. master_download is untouched.
--
-- DESTRUCTIVE OPS (approved before apply): ALTER portal_links ADD COLUMN (idempotent);
-- DROP the old create_screener_link(uuid,text,timestamptz) overload + CREATE the 4-arg version
-- (p_share_token has DEFAULT null per the gen-types gotcha). Forward-only. No data deleted.

alter table public.portal_links
  add column if not exists share_token text;  -- screener_view only; null for master_download

-- Replace the 3-arg overload with the share-token-aware one. DROP first (a differing arg list
-- would create a second overload, not replace) — mirrors the create_title pattern.
drop function if exists public.create_screener_link(uuid, text, timestamptz);

-- p_share_token is LAST so existing 3-arg positional callers (…, p_expires_at) keep working;
-- the app calls with named args regardless.
create or replace function public.create_screener_link(
  p_title_id    uuid,
  p_token_hash  text,
  p_expires_at  timestamptz default null,
  p_share_token text default null
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

  -- Single active link per title: withdraw any live screener link before minting the new one.
  -- (This is the "reset" — the previously-shared URL stops resolving in the portal.)
  update public.portal_links
     set revoked_at = now()
   where title_id = p_title_id and purpose = 'screener_view' and revoked_at is null;

  insert into public.portal_links (purpose, title_id, token_hash, share_token, created_by, expires_at)
  values ('screener_view', p_title_id, btrim(p_token_hash), p_share_token, auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_screener_link(uuid, text, timestamptz, text) from public, anon;
grant  execute on function public.create_screener_link(uuid, text, timestamptz, text) to authenticated;
