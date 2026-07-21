# GC Operator Pass — Implementation Plan

> Fold Review (and later Deliveries) into a unified Queue + per-title GC detail. Built in
> shippable phases; each phase is pushed so the founder can react. Model: memory `gc-operator-model`.

**Goal:** GC operates from one **Queue** (titles by stage) + a **per-title GC detail** (review, internal
asset viewing, approve/reject, delivery). Review/Deliveries tabs fold in; Vendors stays as settings.

## Global constraints
- GC-only surfaces gated by `is_gc_staff` (RLS bypass); cross-org reads.
- GC sees everything; clients scoped to own account. Neutral tokens, GC voice.
- Workflow must feel natural/non-clunky (founder). `pnpm build` + tests + leak-check green each phase.

## Phase 1 — GC title detail + fold Review  *(this phase now)*
- **Create** `src/app/gc/titles/[id]/page.tsx` — GC title detail: header (title · catalog · org · GC status);
  metadata (read); rights/territories; exclusive-conflict warning; same-work linking; **approve/reject**
  (reuse `ReviewControls`); screener link panel (reuse `ScreenerPanel`); per-title findings. Cross-org via RLS.
- **Modify** `src/app/gc/queue/page.tsx` — rows link to `/gc/titles/[id]` (both groups).
- **Modify** `src/app/gc/gc-nav.tsx` — remove the "Review" item.
- **Redirect** `src/app/gc/review/page.tsx` → `/gc/queue` (keep the shared components it used:
  `review-controls`, `link-controls`, `screener-panel` — the detail imports them).
- Reuses existing review logic; **no backend change**. Ships "Review folded into Queue."

## Phase 2 — Internal asset viewer (needs GC signing)
- New: a GC-only way to get a signed CloudFront URL for ANY asset (is_gc_staff), separate from the
  portal's service-role `portal_resolve_download`. Likely `src/app/api/gc/asset-url` (route, is_gc_staff)
  + `resolveOrRestore` reuse for Glacier. On the detail: screener **player** + asset list with view/download.
- Confirm no client exposure (server-only signing).

## Phase 3 — Delivery from the detail + fold Deliveries
- On the detail (approved titles): create delivery placement(s) (title × vendor × territory), generate the
  vendor link/export inline; support multiple vendors. Queue "Delivering/Live" stages. Redirect
  `/gc/deliveries` → queue (keep an optional cross-title delivery log later). Reuses `create_delivery`,
  portal-link gen, export.

## Phase 4 — Email notifications for approve/reject
- Wire Resend (`@/lib/email`) into the title-status notification path (approve/reject) so the client is
  notified **in-app AND email** (email was deferred; now in scope). Keep in-app as source of truth.

## Phase 5 — Asset actions + findings polish
- Asset actions on the detail: flag missing/wrong, request re-upload, mark "master received" (new RPC/finding).
- Findings as per-title flags on the detail + a Queue filter.

## Verify (each phase)
Build + tests + leak-check; manual walk of the GC flow on the live site.
