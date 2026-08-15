-- 20260808000100_hide_gc_unnamed_screener_links.sql
--
-- INTENT: close the unnamed-link / master-stream control bypass that
-- 20260806000300's portal_links_select transparency + the portal stream route's
-- unnamed-link master-source exemption opened together. Founder rejected shipping
-- that residual into production (Option D — 2026-08-08).
--
-- LAYER B (this migration) — narrow RLS/token visibility only:
--   Client operate-capable members keep seeing NAMED screener_view links on their
--   own titles (003's approved buyer/pitch transparency, including GC-authored
--   named links). They must NOT SELECT GC-authored UNNAMED operational screener
--   links (purpose = screener_view, recipient_name IS NULL, created_by ∈ gc_staff)
--   — those rows carry plaintext share_token for GC's ScreenerPanel workflow.
--
-- LAYER A (application, sibling change) — portal /api/portal/screener refuses
--   master-source playback for ALL links, including GC unnamed. Dedicated proxy
--   is the required portal viewing path. Not encoded here.
--
-- NOT a full author-partition restore from 20260806000200. Named GC buyer links
-- remain client-visible. GC staff visibility via gc_can('view') is unchanged.
--
-- is_gc_staff(created_by) classifies the ROW AUTHOR (SECURITY DEFINER membership
-- predicate). It is NOT used as a viewer authorization gate — viewer power still
-- routes through gc_can / member_can only. Inline EXISTS on gc_staff would fail
-- closed for clients who cannot read that table and silently leave ops links visible.
--
-- revoke_portal_link title-status gate is a SEPARATE open founder issue — not this
-- migration.
--
-- IDEMPOTENT REINSTALL. 20260806000300 already ships this exact terminal policy so a
-- mid-batch stop after 000300 is already safe. This file DROP + CREATE the same text
-- so an accidental edit to 000300 cannot be the last word. Not verification-only.
--
-- DESTRUCTIVE OPS: DROP + CREATE of portal_links_select only. No table/column/data
-- change. Forward-only policy replace. Do not apply from an agent.

drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (
    public.gc_can(auth.uid(), 'view')
    or (
      purpose = 'screener_view'
      and title_id is not null
      and exists (
        select 1 from public.titles t
        where t.id = portal_links.title_id
          and public.member_can(auth.uid(), t.org_id, 'operate')
      )
      and not (
        recipient_name is null
        and public.is_gc_staff(created_by)
      )
    )
  );
