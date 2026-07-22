# Dashboard UI design pass — Foundation + brand adoption

**Date:** 2026-07-22 · **Status:** Foundation (Section 1) approved + built; screens are the roadmap.

## North star
The dashboard should feel like **great tech, on-brand, living between Coinbase and Mercury** — Mercury's restraint/whitespace/typography + Coinbase's confident data emphasis + Stripe's operator density (for the GC side). This matches GC's compiled voice: calm, premium, restrained, expert — "operating infrastructure, not a SaaS product."

## Brand truth (from globalcontent-web, the source of brand truth)
- **Confirmed brand accent = "Sporty Blue" `#1769FF`** (founder-set 2026-07-18). The logo/wordmark is a *separate* founder checkpoint, still pending — but the accent is decided. The dashboard was still on a neutral-grey placeholder; that was the single biggest off-brand thing.
- Near-white `#fafafb` canvas, ink `#14171a`, generous whitespace. Color is essentially absent except the blue, used **sparingly** (primary action, links, focus, small badges, data accents; kept off small body copy — white-on-blue is ~3.9:1).
- Cards = hairline-bordered, rounded, **no shadow**. Buttons = **pill**, filled blue, subtle hover lift. Geist sans headings (medium, sentence case, tight tracking); **figures in Geist Mono tabular** ("read as instruments"). Signature dark **charcoal band** for one dramatic moment. Subtle film grain on the marketing site.
- House rule: **design tokens only, greyscale + ONE accent.** Never hardcode hex.

## Approach (founder-chosen: A)
Foundation first (adopt brand + align shared primitives), then elevate the highest-traffic screens (Dashboard → Titles → a title detail) to the reference bar; the long tail inherits the new patterns.

## Section 1 — Foundation (BUILT in this PR)
- **Adopt Sporty Blue:** `--accent: #1769ff` in `tokens.css` (replaces the grey placeholder; comment corrected). Propagates instantly — every button, link, focus ring, active state, badge, and `hover:border-accent` becomes on-brand blue.
- **Buttons → pills:** `rounded-full` + subtle hover lift (`-translate-y-px`, settles on press) — the globalcontent-web recipe. Geometry from tokens, color from variant.
- **Cards → rounder:** `--radius` (10px) → `--radius-lg` (14px). Quiet hairline, no shadow.
- **Figures/eyebrows already correct:** `StatTile` + the `t-data` (Geist Mono tabular) and `t-label` (mono uppercase) classes already exist and are used — the system was built for this. **Eyebrows stay MONO** (founder decision: suits an operator tool, pairs with mono figures), and stay muted grey (blue reserved for actions/data, not chrome).

### Deliberately deferred (with reasoning)
- **Sparkline / mini-chart:** build with its first real caller in the Dashboard section (YAGNI — tune to real data).
- **Film grain:** held. The three references (Mercury/Coinbase/Stripe) are crisp and flat — grain is a marketing-site texture. The blue + mono figures + pills + rounder cards deliver the "great tech" feel without it. Revisit only if the founder wants it.
- **Charcoal band:** reserved for a single dramatic moment (e.g. an insights/portal header) — applied when that screen is designed, not globally.

## Roadmap (subsequent sections, each its own PR)
- **Section 2 — Dashboard:** metric tiles with sparklines, a hero figure/overview treatment, clearer hierarchy, the "Just in / attention" blocks elevated. (Mockup worth doing.)
- **Section 3 — Titles + a title detail:** list density + the detail page (rights/deliveries/assets/metadata) at reference fidelity.
- **Section 4 — Operator surfaces (Queue/Vendors/deliveries):** Stripe-grade density — filter pills, tabular precision, metric headers.
- Long tail (Catalog Health, Messages, onboarding) inherits the patterns.

## Verification
Every change is build-verified (typecheck/lint/next build). No migration, no data changes — purely tokens + shared primitives. Visual review on the PR preview: blue accent throughout, pill buttons, rounder cards.
