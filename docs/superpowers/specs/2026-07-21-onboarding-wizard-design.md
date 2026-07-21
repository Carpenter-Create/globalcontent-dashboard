# Onboarding Wizard — Design Spec

**Date:** 2026-07-21
**Status:** Approved (founder), ready for implementation plan

## Context
The app is live. Today a new client hits a bare create-org form, then a plain `/agreement` clickwrap,
then `/agreement/pay` — three disconnected screens, and (before this) a client could land in the dashboard
without a deliberate, branded experience. The founder wants the first-run experience to be a **guided,
full-screen welcome** that (a) orients the user to what the platform does via feature highlights and
(b) walks them through the required setup (organization → plan → agreement → payment) before they ever
reach the dashboard. **Everyone** goes through it — no free-tier shortcut.

This is a **presentation-layer** change: the backend (org creation, terms, Stripe checkout/webhook) already
exists and is unchanged. We unify the existing steps into one guided wizard and add a welcome step.

## Goal
A single full-screen, one-decision-per-screen onboarding wizard — Stripe's *structure*, GC's brand — that
no signed-in user can bypass until their org is `active`, resuming at the correct step from their status.

## Non-goals (v1)
- No schema/RPC changes. No changes to `accept_terms`, `create_org_and_membership`, Stripe checkout/webhook.
- No building of Globee or analytics (shown only as clearly-labeled "coming soon").
- No full company-profile editor (the welcome tile only previews the concept; profile editing is later).
- Term-change / downgrade / lapse re-onboarding flows (those reuse `accept_terms` elsewhere; out of scope).

## Decisions (locked)
- **Route:** `/onboarding` (full-screen, outside the app shell).
- **Step 2 collects org name only.**
- **Feature highlights:** Turn in titles (live) · Dashboard (live) · Analytics (coming soon) ·
  Globee AI assistant (coming soon) · Company profile. Coming-soon tiles clearly badged; copy must not
  imply they're usable now (brand rule: never invent/promise capabilities).
- **Brand:** GC voice + neutral design tokens (NOT Stripe purple). Full-screen, GC wordmark, thin progress
  indicator, Back/Continue, card choices. "Show the work" on pricing (tier, annual rate, term, what they accept).

## Flow (welcome first, then set up)
1. **Welcome** — "Welcome to Global Content" + the 5 feature-highlight cards (coming-soon badged where noted).
   Single "Get started" CTA. No data collected.
2. **Your organization** — org name input → on continue calls `createOrg` → `create_org_and_membership`
   (org created `registered`).
3. **Choose your plan** — three cards from `TIER_META`: Access $0 · Pro $497/yr · Premium $997/yr. Select one.
4. **Agreement** — clickwrap: rendered terms + explicit accept → `accept_terms(tier)`
   (free/Access → org `active`; paid → org `awaiting_payment`, writes the agreement source doc + `contract_terms`).
5. **Payment** — Pro/Premium only: embedded Stripe Payment Element (client secret from `/api/stripe/checkout`,
   which reads the `awaiting_payment` org + accepted paid agreement). On success the Stripe webhook
   (`finalize_paid_signup`) flips the org `active`. **Access skips this step entirely.**
6. **You're all set** — brief confirmation → enter the dashboard.

## Enforcement & resume
- Any signed-in user whose active-membership org is **not `active`** is routed into `/onboarding`
  (replaces today's inline create-org form in `(app)/page.tsx` and the bare `redirect("/agreement")` in
  `(app)/layout.tsx`).
- The wizard **resumes at the correct step** derived from state:
  - no org → step 2 (organization)
  - org `registered` (no accepted terms) → step 3/4 (plan + agreement)
  - org `awaiting_payment` → step 5 (payment)
  - org `active` → leave the wizard, go to dashboard.
- Back navigation allowed between not-yet-committed steps; once `active`, the wizard is done (can't un-pay).

## Reuse (existing, unchanged)
- `src/app/actions.ts` `createOrg` / `create_org_and_membership` (step 2)
- `src/app/agreement/actions.ts` `accept_terms` (step 4)
- `src/app/api/stripe/checkout` + webhook + `finalize_paid_signup` (step 5)
- `src/lib/agreements.ts` `TIER_META` (plan cards + amounts)
- `src/app/agreement/pay/payment-checkout.tsx` Payment Element (fold into step 5)

## Files (anticipated)
- **Create:** `src/app/onboarding/` — full-screen layout (no AppShell) + a client wizard with step state,
  plus per-step components (welcome, organization, plan, agreement, payment, done).
- **Modify:** `src/app/(app)/layout.tsx` + `src/app/(app)/page.tsx` — route non-active orgs to `/onboarding`
  and remove the inline onboarding form.
- **Absorb/retire:** `src/app/agreement/*` pages (logic moves into wizard steps; keep the server actions).

## Brand/voice guardrails
- Declarative, calm, premium; no banned words. Coming-soon copy: e.g. "Analytics — in development" / "coming soon",
  never "maximize your revenue" etc.
- Pricing transparency: name the tier, annual rate, term, and exactly what they're agreeing to at the agreement step.
- Neutral accent tokens only (accent is a placeholder pending logo — founder checkpoint).

## Verification
- Manual: a fresh signup traverses welcome → org → plan → agreement → (pay if paid) → dashboard, and cannot
  reach the dashboard until `active`. Free (Access) path skips payment and lands active. Paid path pays with a
  Stripe test card and the webhook activates. Mid-flow drop resumes at the right step.
- `pnpm build` + `pnpm test` green; `leak-check` clean (no new client secrets).
