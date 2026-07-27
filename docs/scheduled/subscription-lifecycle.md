# The subscription lifecycle is unbuilt after signup

*Written 2026-07-27. **Scoping only — nothing built.** Raised while registering B5 (the live-mode
Stripe webhook). B5 is "the endpoint is not registered"; this is "even once it is, the app only
understands the first payment."*

---

## 1. What exists

One event. `src/app/api/stripe/webhook/route.ts:26` handles `checkout.session.completed` and
nothing else. It calls `finalize_paid_signup`, which writes `subscriptions` + `contract_terms`
and flips the org to `active`.

That is the whole of it. Verified against the schema rather than the code alone, and the schema
is where it shows most clearly.

## 2. What the schema already anticipates — and cannot reach

The data model describes the full lifecycle. None of it is wired.

| | Values | Reachable today |
|---|---|---|
| `term_trigger_enum` | `signup`, `upgrade`, `downgrade`, `lapse`, `renewal`, `reinstate` | **`signup` only** |
| `org_status` | `registered`, `awaiting_payment`, `active`, `payment_lapsed`, `closed` | `payment_lapsed` is **unreachable** |
| writers of `public.subscriptions` | — | **`finalize_paid_signup` only** |

Measured, not inferred: a catalog scan for functions whose body writes `payment_lapsed` returns
**nothing**, and a scan for the six trigger literals finds only `accept_terms` and
`finalize_paid_signup`, both writing `'signup'`.

**`payment_lapsed` already has a UI label** — `src/app/(app)/page.tsx:25`, `"Payment lapsed"`. The
interface renders a state the database cannot produce. This is the same shape as L7's Q3 finding
about unreachable `title_status` values, and it is worth naming as a class: *an enum value with no
writer is a design intention that reads, to every future maintainer, as a shipped feature.*

## 3. What breaks, in cost order

**1. A failed renewal grants indefinite free access.** No `invoice.payment_failed` handler, no
lapse path, `payment_lapsed` unreachable. A client whose card expires keeps their full tier —
catalog, delivery, everything — permanently. Nothing degrades, nothing alerts, no term is written.
This is the revenue leak, and it is silent on both sides: the client does not know either.

**2. Cancellation does nothing.** No `customer.subscription.deleted`. A client who cancels in
Stripe keeps full access forever. Stripe stops charging; GC keeps delivering.

**3. `contract_terms` stops being true at the first renewal.** CLAUDE.md rule 8: *"webhooks/cron
write system-initiated terms (lapse/renewal). The math reads terms only."* With no renewal term,
the table shows a single `signup` row for the life of the account. Rule 6 makes `contract_terms`
the effective-dated record of what was agreed and when; rule 4 requires every derived number to
carry `source_refs` + `logic_version`. **A revenue statement computed against a terms table that
stopped updating a year ago is untraceable and wrong, and it will look right.** This is the one
that is cheap now and expensive after the revenue module lands.

**4. `subscriptions.current_period_end` silently goes stale.** Written once at signup, never
updated, because `finalize_paid_signup` is its only writer. Anything that reads it — renewal
reminders, expiry gating, the dashboard — is wrong from the first renewal onward. It is a recorded
date that quietly stopped being true, which is precisely the failure rule 9 warns about in a
different context.

**5. Upgrade and downgrade write no terms.** Client-initiated per rule 8, so not strictly webhook
work, but the same gap: `accept_terms` only ever writes `'signup'`. A tier change today leaves no
record of what changed, when, or at what rate — and the rate is meant to be **snapshotted** onto
the term, never read back from `tiers` (rule 6).

## 4. What building it requires

**Events to handle**, mapped to the terms they write:

| Stripe event | Writes | Notes |
|---|---|---|
| `invoice.paid` (renewal) | `contract_terms` trigger `renewal`; refresh `subscriptions.current_period_end` | `effective_from` = **event timestamp, never `now()`** (rule 8) |
| `invoice.payment_failed` | nothing yet — starts the lapse clock | Stripe retries for days; do not lapse on the first failure |
| `customer.subscription.deleted` | `contract_terms` trigger `lapse`; org → `payment_lapsed` | |
| `customer.subscription.updated` | `upgrade` / `downgrade` where the tier changed | Watch for Stripe-initiated changes that did not come through the clickwrap |

**A cron job, and there is no cron infrastructure at all.** No `supabase/functions`, no
`vercel.json` or `vercel.ts`, so no scheduled anything exists today. Rule 8 is explicit that lapse
is the exception with no event: *"use `lapsed_at + 30 days`. The lapse job must be idempotent."*
That is a new deployment surface, not just a new handler.

**Two rules that constrain the design, and are easy to violate here:**

- **Rule 11 — a tier change gates future actions; it never retroactively destroys existing state.
  Enforce at the point of action, never as a sweep.** The tempting lapse implementation is a
  nightly job that takes down titles for lapsed orgs. That is exactly the forbidden sweep, and it
  would auto-take-down live titles.
- **Rule 12 — rights grants expand, never contract.** A lapse must not shrink an existing grant's
  scope; GC would be left distributing where it has no rights.

**Idempotency and ordering.** Stripe redelivers, and out of order. Every handler must be safe to
run twice — `finalize_paid_signup` already is, and the rest must match. Terms are immutable
(rule 6), so a duplicate event must not write a second term.

## 5. Cost

| Piece | Size |
|---|---|
| Renewal + cancellation handlers, term writing | Medium — the term semantics are the work, not the webhook plumbing |
| Lapse cron + first scheduled-job deployment surface | Medium, and it is new infrastructure |
| Upgrade/downgrade terms through the clickwrap | Medium — belongs with the tier-change UI |
| `reinstate` | Small, once lapse exists |
| Making `payment_lapsed` reachable and the UI honest | Small |

## 6. What is a launch blocker and what is not

**Blocker before the first paying client:** renewal and cancellation handling. Without them, the
first client who cancels or whose card fails keeps everything, indefinitely, and GC finds out by
noticing the money stopped.

**Not a blocker, but before the revenue module:** the `renewal` term writing. The revenue module
reads `contract_terms` and nothing else (rule 8). Building statements on a terms table that has
never recorded a renewal produces numbers that are confidently wrong.

**Not urgent:** `reinstate`, and upgrade/downgrade, which need the tier-change UI anyway.

---

*Related: B5 in `SECURITY-STATUS.md` §6 — registering the live-mode endpoint. B5 is the
precondition; this is what the endpoint would still fail to do afterwards.*
