-- ============================================================================
-- 20260717000200_accept_terms_optional_context.sql
--
-- INTENT: make accept_terms' client-context args (p_ip, p_user_agent) OPTIONAL —
-- they are best-effort assent metadata and are legitimately absent (e.g. no
-- x-forwarded-for in local dev; '' is invalid for inet). Adding `default null`
-- makes them nullable/optional in the generated types so callers pass what they have.
-- Body unchanged from 20260717000100. CREATE OR REPLACE preserves existing grants.
-- Forward-only; not a rewrite of the applied migration.
-- ============================================================================

create or replace function public.accept_terms(
  p_tier          public.tier_enum,
  p_terms_version text,
  p_content_hash  text,
  p_rendered_text text,
  p_ip            inet default null,
  p_user_agent    text default null
) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_doc uuid;
  v_rate int := 0;   -- PLACEHOLDER revenue share (bp) — real rates open (§21.5)
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select m.org_id into v_org
  from public.memberships m
  where m.user_id = v_uid and m.status = 'active' and m.role = 'account_owner'
  limit 1;
  if v_org is null then
    raise exception 'Only the account owner can accept the agreement';
  end if;

  insert into public.source_documents (org_id, kind, provided_by, content_hash, raw)
  values (v_org, 'agreement', v_uid, p_content_hash,
          jsonb_build_object('terms_version', p_terms_version, 'tier', p_tier, 'text', p_rendered_text))
  returning id into v_doc;

  insert into public.contract_assents
    (org_id, user_id, terms_version, content_hash, source_document_id, ip, user_agent)
  values (v_org, v_uid, p_terms_version, p_content_hash, v_doc, p_ip, p_user_agent);

  if p_tier = 'access' then
    insert into public.contract_terms
      (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
    values (v_org, 'access', v_rate, now(), 12, now() + interval '12 months', 'signup', v_doc);
    update public.organizations set status = 'active' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', false);
  else
    update public.organizations set status = 'awaiting_payment' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', true);
  end if;
end $$;
