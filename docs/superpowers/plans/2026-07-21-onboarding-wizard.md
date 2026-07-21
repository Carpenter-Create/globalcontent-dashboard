# Onboarding Wizard — Implementation Plan

> Execute inline (executing-plans style). Presentation-layer only; reuses existing server actions/RPCs.

**Goal:** A full-screen, guided, one-decision-per-screen onboarding wizard at `/onboarding` that no
signed-in user can bypass until their org is `active`, resuming at the right step from status.

**Architecture:** Server-rendered step pages under `/onboarding/*` wrapped in a shared full-screen wizard
layout (GC wordmark + progress indicator, NO AppShell). Each page resumes-from-status via server redirects
(the pattern the current `/agreement*` pages already use). Reuses `createOrg`, `acceptAgreement`/`accept_terms`,
Stripe checkout + webhook + `CompletePoller`, and `TIER_META`. No schema/RPC changes.

## Global Constraints
- GC brand: neutral design tokens only (no hardcoded hex, no Stripe purple), GC voice, no banned words.
- Coming-soon features (Analytics, Globee) must be badged "coming soon" and never implied as usable.
- Everyone traverses it (incl. free Access); resume from status; can't reach dashboard until `active`.
- `pnpm build` + `pnpm test` green; `leak-check` clean.

## Steps / routes (progress order)
1. `/onboarding` — **Welcome**: heading + 5 feature-highlight cards (Turn in titles ✓, Dashboard ✓,
   Analytics ᴮᴱᵀᴬ/coming-soon, Globee AI coming-soon, Company profile) + "Get started" → `/onboarding/organization`.
   If active org → redirect dashboard.
2. `/onboarding/organization` — org name form (reuse `OnboardingForm` logic; `createOrg` → next). If org
   already exists → redirect forward (`/onboarding/plan`).
3. `/onboarding/plan` — plan cards + agreement clickwrap (port `agreement/page.tsx` + `AcceptForm`).
   Resume: no org → step 2; awaiting_payment → step 4; active → dashboard.
4. `/onboarding/payment` — embedded Payment Element (port `pay/page.tsx` + `PaymentCheckout`). awaiting_payment only.
5. `/onboarding/complete` — Stripe `return_url`; "You're all set" + `CompletePoller` → dashboard.

## Tasks
1. **Wizard layout** — create `src/app/onboarding/layout.tsx`: full-screen (no AppShell), GC wordmark,
   thin progress bar. Derive current step from a small `STEP_ORDER` + the child (pass via segment). Simplest:
   a `WizardChrome` client/server wrapper that reads `headers()` pathname or each page passes `step={n}`.
   Decision: each page renders `<WizardFrame step={n} total={5} title=…>` (server component in `_frame.tsx`).
2. **Welcome page** — `src/app/onboarding/page.tsx` (server: redirect active→`/`), feature cards + CTA.
   Copy in `src/lib/onboarding.ts` (content module, per repo convention — copy lives in lib/).
3. **Organization step** — `src/app/onboarding/organization/page.tsx` + reuse `OnboardingForm`. Change
   `createOrg` redirect target `/` → `/onboarding/plan`.
4. **Plan+agreement step** — `src/app/onboarding/plan/page.tsx`: port the tier-cards + terms + `AcceptForm`
   from `agreement/page.tsx`. Change `acceptAgreement` redirects: paid→`/onboarding/payment`,
   free→`/onboarding/complete` (poller handles free? no — free is already active, so →`/?welcome=1`).
   → free: redirect `/?welcome=1`; paid: `/onboarding/payment`.
5. **Payment step** — `src/app/onboarding/payment/page.tsx` port of `pay/page.tsx` + reuse `PaymentCheckout`.
   Update Stripe `return_url` in `src/app/api/stripe/checkout/route.ts` → `${origin}/onboarding/complete?session_id={CHECKOUT_SESSION_ID}`.
6. **Complete step** — `src/app/onboarding/complete/page.tsx` port of `complete/page.tsx` + reuse `CompletePoller`
   ("You're all set" heading). Poller already routes to `/?welcome=1`.
7. **Gate + entry** — `src/app/(app)/layout.tsx`: non-active org redirect `/agreement` → `/onboarding`.
   `src/app/(app)/page.tsx`: remove inline `OnboardingForm`; no-org case → `redirect("/onboarding")`.
8. **Retire old routes** — delete `src/app/agreement/` pages (`page.tsx`, `pay/page.tsx`, `complete/page.tsx`);
   KEEP shared pieces used by the wizard: `agreement/actions.ts` (or move to `onboarding/actions.ts`),
   `AcceptForm`, `PaymentCheckout`, `CompletePoller` (move under `onboarding/`). Keep `/api/org/status`.
9. **Verify** — build + tests + leak-check; manual: fresh signup traverses welcome→org→plan→agreement→
   (pay if paid)→dashboard; free skips pay; can't reach dashboard until active; mid-flow resume.

## Notes
- `createOrg` and `acceptAgreement` currently `redirect()` server-side — just change their targets.
- No new env, no migration. Payment return_url is the only API change.
- Design polish (exact card layout, progress bar style) iterated on the live site with the founder.
