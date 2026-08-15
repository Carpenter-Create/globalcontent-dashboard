# Authenticated production smoke — founder runbook

**Founder-only.** Cursor and Codex must not execute this runbook against production. Agents may draft or revise these instructions; applying them, opening the production origin, using production credentials or sessions, and recording a live result remain founder-executed only.

This runbook does not change operating posture. Authenticated operator/client smoke stays **Deferred** in [`docs/status/CURRENT.md`](../status/CURRENT.md) until a later founder-authorized closeout cycle, after [`authenticated-smoke-results.md`](authenticated-smoke-results.md) shows Overall = Pass with all 16 checks Pass. Do not edit `CURRENT.md` as part of this run.

Unauthenticated smoke is already **Passed**. Do not reopen it. Do not resume Phase C or `ae/control`.

Companion evidence log: [`authenticated-smoke-results.md`](authenticated-smoke-results.md).

---

## Scope

- **Surface:** authenticated Access-tier client paths and `gc_staff` operator paths on production.
- **Client:** desktop only.
- **Payment:** none. No live card. Do not open Stripe Checkout, paid signup, or `/onboarding/payment`.
- **Out of scope:** portal/AWS/MediaConvert, team invites, mobile, pagination, statements, vendor naming, counsel agreement text, revenue-share rates, `source_documents` work.

If a numbered step cannot be completed inside this scope, **stop**. Record **Blocked** for that check and any not-yet-run later checks that depend on it. Do not improvise paid signup, AWS, or portal steps.

---

## Before you start

1. Fill `PRODUCTION_APP_ORIGIN` below with the app origin you already use. Do not invent a hostname. If you prefer not to write a hostname into the public repository, leave the blank as `PRODUCTION_APP_ORIGIN` in the results header as well.
2. Use an existing Access-tier org or create one during checks 2–3. Role for title creation must be Operate: `account_owner` or `delivery_ops`.
3. Use a `gc_staff` mailbox for checks 12–15. Check 16 must **not** use that staff session.
4. Work on a desktop browser. Complete Turnstile in the page if a challenge appears.
5. Prepare the results file. Record timestamps in **America/Chicago**.

Production origin (founder-filled blank; do not open it from an agent session):

```
PRODUCTION_APP_ORIGIN=
```

Paths below are relative to that origin. Example: check 1 is `PRODUCTION_APP_ORIGIN/login`.

---

## Evidence and secrets

- Do not read or paste secrets, `.env`, `.env.*`, or anything under `secrets/`.
- Do not paste magic-link tokens, raw magic-link URLs, cookies, or session values into the repository.
- Record **role and mailbox label only** (for example “Access client test”, “gc_staff”). Never record actual mailbox addresses, passwords, or raw links.
- All committed evidence must be sanitized for a public repository. See the results template for the forbidden list.
- Evidence must be sufficient to establish pass/fail while remaining sanitized for a public repository.
- If a failure requires preserving sensitive diagnostic evidence, record only a sanitized summary in the repository and retain the detailed evidence outside the repository.

---

## Client checks (Access-tier org)

Use the Access client mailbox. Magic-link + Turnstile. No live card.

### 1. Magic-link sign-in

| | |
| --- | --- |
| **Path** | `/login` → `/auth/callback` |
| **Role** | client Access |
| **Action** | Open `/login`. Request a magic link with Turnstile completed. Open the link from mail in this same desktop browser so `/auth/callback` can establish the session. Do not paste the link or token into the repository. |
| **Expected** | After callback, an authenticated session exists (app chrome or onboarding, not the signed-out login form). |
| **Fail** | Login error, Turnstile failure, callback returns to `/login?error=auth`, or no session after a completed link. |

### 2. Organization (only if none)

| | |
| --- | --- |
| **Path** | `/onboarding/organization` |
| **Role** | client Access |
| **Action** | If this mailbox already has an organization, do not create another. Record Pass and note that the precondition was already met. If none: open `/onboarding/organization`, name the organization, submit. |
| **Expected** | Organization exists and the user is `account_owner`. The next screen is plan/agreement or the app shell — not payment. |
| **Fail** | Org creation errors, user is not `account_owner`, or the flow sends the Access client to payment. |

### 3. Access clickwrap (only if not yet accepted)

| | |
| --- | --- |
| **Path** | `/onboarding/plan` (Access) |
| **Role** | client Access |
| **Action** | If Access terms are already accepted and the org is active, do not re-accept. Record Pass and note that the precondition was already met. If not accepted: choose **Access** (free). Read the clickwrap. Accept. Do not choose Pro or Premium. |
| **Expected** | Land in the app shell (typically `/?welcome=1` or `/`). Do **not** land on `/onboarding/payment` or any card-entry surface. |
| **Fail** | Accept errors, paid-tier selected, or redirect to payment / card entry. |

### 4. Dashboard

| | |
| --- | --- |
| **Path** | `/` |
| **Role** | client Access |
| **Action** | Open `/`. |
| **Expected** | Dashboard loads in the app shell without an error page. Visible heading context is the dashboard (including the screen-reader “Dashboard” title). |
| **Fail** | Error page, unexpected redirect away from the shell, or a blank/broken render. |

### 5. Titles

| | |
| --- | --- |
| **Path** | `/titles` |
| **Role** | client Access |
| **Action** | Open `/titles`. |
| **Expected** | Page heading **Titles** loads without an error page. Empty catalog is Pass. |
| **Fail** | Error page, unexpected redirect, or a blank/broken render. |

### 6. Deliveries

| | |
| --- | --- |
| **Path** | `/deliveries` |
| **Role** | client Access |
| **Action** | Open `/deliveries`. |
| **Expected** | Page heading **Deliveries** loads without an error page. Empty list is Pass. |
| **Fail** | Error page, unexpected redirect, or a blank/broken render. |

### 7. Catalog Health

| | |
| --- | --- |
| **Path** | `/catalog-health` |
| **Role** | client Access |
| **Action** | Open `/catalog-health`. |
| **Expected** | Page heading **Catalog Health** loads without an error page. |
| **Fail** | Error page, unexpected redirect, or a blank/broken render. |

### 8. Messages

| | |
| --- | --- |
| **Path** | `/messages` |
| **Role** | client Access |
| **Action** | Open `/messages`. |
| **Expected** | Page heading **Messages** loads without an error page. |
| **Fail** | Error page, unexpected redirect, or a blank/broken render. |

### 9. Agreements list

| | |
| --- | --- |
| **Path** | `/account/agreements` |
| **Role** | client Access |
| **Action** | Open `/account/agreements`. |
| **Expected** | Page heading **Agreements**. The list includes the Access assent (label of the form “Access agreement”). Do not download or paste agreement text, hashes, or document identifiers into the repository. |
| **Fail** | Error page, empty list when Access was accepted in this or a prior setup, or a non-Access assent shown as the only record when Access was the accepted tier. |

### 10. Title stub (Operate role)

| | |
| --- | --- |
| **Path** | `/titles` |
| **Role** | client Access, Operate (`account_owner` or `delivery_ops`) |
| **Action** | On `/titles`, use **Title** → **Add a title**. Enter a working title. Leave release as **New release**. Submit **Add title**. Do **not** submit the title to `in_review` unless you explicitly choose to; default is leave as draft. Do not upload assets, open portal/AWS steps, or name vendors. |
| **Expected** | The new stub appears on `/titles`. Committed evidence must be exactly: “Title stub successfully created; production identifier retained privately by founder and not committed to the repository.” |
| **Fail** | Create errors, the Operate control is missing for an Operate role, or the title is advanced to `in_review` without an explicit founder choice. |

### 11. Sign out

| | |
| --- | --- |
| **Path** | user menu → Sign out → `/login` |
| **Role** | client Access |
| **Action** | Open the user menu. Choose **Sign out**. |
| **Expected** | Session ends. Browser is on `/login` (signed-out “Sign in” form). |
| **Fail** | Still authenticated, error page, or not returned to `/login`. |

---

## Operator checks (`gc_staff`)

Use the staff mailbox. Do not use this session for check 16.

### 12. Staff sign-in

| | |
| --- | --- |
| **Path** | `/login` → `/auth/callback` |
| **Role** | `gc_staff` |
| **Action** | Open `/login`. Request a magic link with Turnstile. Complete `/auth/callback` in this desktop browser. Do not paste the link or token into the repository. |
| **Expected** | Authenticated staff session. |
| **Fail** | Login error, callback failure, or no session. |

### 13. Queue

| | |
| --- | --- |
| **Path** | `/queue` |
| **Role** | `gc_staff` |
| **Action** | Open `/queue`. |
| **Expected** | Page heading **Queue** loads without an error page. Empty sections are Pass. |
| **Fail** | Error page, redirect to `/` or `/login`, or a blank/broken render. |

### 14. GC deliveries

| | |
| --- | --- |
| **Path** | `/gc/deliveries` |
| **Role** | `gc_staff` |
| **Action** | Open `/gc/deliveries`. Load only. Do not create deliveries, generate portal links, or export. |
| **Expected** | Page heading **Deliveries** loads without an error page. Empty list is Pass. |
| **Fail** | Error page, redirect to `/` or `/login`, or a blank/broken render. |

### 15. Vendors

| | |
| --- | --- |
| **Path** | `/vendors` |
| **Role** | `gc_staff` |
| **Action** | Open `/vendors`. Load only. Do not create or edit vendors. Do not record vendor names in the repository. |
| **Expected** | Page heading **Vendors** loads without an error page. Empty list is Pass. |
| **Fail** | Error page, redirect to `/` or `/login`, or a blank/broken render. |

### 16. Operator routes refused (negative)

| | |
| --- | --- |
| **Path** | `/queue`, `/gc/deliveries`, `/vendors` |
| **Role** | unauthenticated-or-client (not `gc_staff`) |
| **Action** | Sign out of the staff session first, or use a separate browser profile. From a **logged-out** session and/or the **Access client** session, open each operator path above. Do **not** use a staff session for this check. |
| **Expected** | Each path is refused: logged-out → redirect to `/login`; client session → redirect to `/` (or not found). The operator page heading must not render. |
| **Fail** | Any operator page loads for a logged-out or client session. |

---

## After the run

1. Fill [`authenticated-smoke-results.md`](authenticated-smoke-results.md): header plus one row per check 1–16.
2. Overall is **Pass** only if checks 1–16 are all Pass. Any Fail or Blocked is not a complete successful run.
3. Sign the results header. Leave `docs/status/CURRENT.md` unchanged in this cycle.
