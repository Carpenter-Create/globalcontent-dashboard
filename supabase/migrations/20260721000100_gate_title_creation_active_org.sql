-- Enforce the onboarding/paywall gate at the DATA layer, not just the UI (golden rule 10:
-- never trust the client). A signed-in user with a non-active org (registered / awaiting_payment /
-- payment_lapsed / closed) must not be able to create content by calling the RPC directly and
-- skipping the onboarding wizard.
--
-- create_title is the single choke point: titles are RPC-only (no client insert; UPDATE/DELETE
-- revoked), and add_rights_grant / create_asset / metadata / submit all require an existing title
-- that belongs to the org. So a non-active org that cannot create a title cannot create anything.
--
-- Non-destructive: CREATE OR REPLACE of one function; adds a status guard, preserves all else.
-- (Lapse-gating of edits to EXISTING titles per rule 11 is a separate follow-up.)

create or replace function public.create_title(p_org_id uuid, p_title text)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_title uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to add titles for this organization';
  end if;
  -- Onboarding/paywall gate: org must have completed agreement (+ payment for paid tiers).
  if (select status from public.organizations where id = p_org_id) <> 'active' then
    raise exception 'Your organization must finish onboarding before adding titles';
  end if;

  insert into public.titles (org_id, title, created_by)
    values (p_org_id, btrim(p_title), auth.uid())
    returning id into v_title;
  return v_title;
end;
$$;
revoke execute on function public.create_title(uuid, text) from public, anon;
grant  execute on function public.create_title(uuid, text) to authenticated;
