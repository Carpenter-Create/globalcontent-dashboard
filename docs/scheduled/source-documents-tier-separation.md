# Scoped, not built: separate the legal instrument from the pricing snapshot in `source_documents.raw`

**Status:** scheduled · **Blocking:** yes — before counsel's agreement text lands
**Found:** 2026-07-26, while closing D1 (`view_financial`)
**Related:** `20260726000900_financial_read_capability.sql` · audit rows E9/E10/E11

---

## What is wrong

`accept_terms` stores the accepted agreement as a single jsonb blob:

```sql
insert into public.source_documents (org_id, kind, provided_by, content_hash, raw)
values (v_org, 'agreement', v_uid, p_content_hash,
        jsonb_build_object('terms_version', p_terms_version, 'tier', p_tier, 'text', p_rendered_text));
--                                                           ^^^^^^^^^^^^^^^
```
*(`20260717000100_clickwrap_stripe_contract_terms.sql:191-194`)*

`source_documents_select` gates on `member_can(..., 'view')`, which after D1 still admits all
five roles — deliberately, because it is the immutable legal record and `legal` must read it.

So `viewer` and `delivery_ops` can read `raw->>'tier'`: the org's commercial plan. D1 closed
the direct reads of `contract_terms`, `subscriptions` and the payout columns, and closed the
audit-log path to all three. **This is the one path it did not close.**

## Why the fix is not "narrow the policy"

Restricting `source_documents` to `view_financial` would deny `viewer` and `delivery_ops` the
*agreement itself*, which is not the problem and not the intent. The blob mixes two things
with different audiences:

| In `raw` today | Who needs it | Sensitivity |
|---|---|---|
| `text` — the rendered agreement | everyone in the org; `legal` especially | the legal instrument |
| `terms_version` | everyone | none |
| **`tier`** | **finance roles only** | **commercial terms** |

Nobody needs the legal instrument and a pricing snapshot in the same object. The tier is
already recorded where it belongs — `contract_terms.tier` and `subscriptions.tier`, both now
behind `view_financial`. Its presence in `raw` is duplication that happens to be readable by
the roles the duplicate was just hidden from.

## Why it becomes urgent before counsel's text lands

Today `raw->>'text'` contains **no pricing** — verified against the live table. That is an
accident of the placeholder: `TERMS_VERSION` is `"2026-07-placeholder"` and the body is marked
`PLACEHOLDER` (`src/lib/agreements.ts:4-9`).

But `renderAgreement(tier)` interpolates `TIER_META[tier]`, which carries `priceLabel` and
`annualPriceCents` (`src/lib/agreements.ts:14-38`). **The moment counsel's real text lands and
that interpolation carries a price into the rendered body, the full annual price is stored in
a column readable by every role in the org** — including the two that were just restricted
from reading the same number two tables over.

That is the trigger. It converts a latent duplication into a live disclosure, and it will
happen as a content change, not a schema change, so nothing in CI will flag it.

## Scope of the fix

1. **Stop writing `tier` into `raw`.** Amend `accept_terms` to store
   `{terms_version, text}` only. The tier is already authoritative in `contract_terms`.
2. **Decide what the rendered text may contain.** Either keep pricing out of the stored body,
   or accept that the body is financial and move the whole document behind a capability. This
   is the substantive decision and it is counsel's as much as engineering's — a contract that
   omits its own price may not be the instrument you want to retain.
3. **Backfill existing rows** — strip `tier` from `raw` on historical agreements. Note this
   conflicts with rule 3 (sources are immutable). The honest resolution is probably to leave
   historical rows alone and document them, not to rewrite an immutable record.
4. **Add negative tests** to `financial_access_test.sql` in the same shape as the rest:
   `viewer` and `delivery_ops` cannot reach tier or pricing through `source_documents`;
   `account_owner`, `accountant` and `legal` can still read the agreement text.

## Why it is not built now

It needs decision (2) before it can be written, and (3) touches an append-only table whose
immutability is a golden rule. Building it tonight would mean guessing at both. The leak is
latent while the placeholder text carries no price, so there is room to decide properly —
but only until counsel's text lands.

## Trigger

**Do this before merging counsel's agreement text.** Anyone changing `renderAgreement()` or
`TERMS_VERSION` should read this file first.
