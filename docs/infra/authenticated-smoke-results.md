# Authenticated production smoke — results

Founder-recorded sanitized evidence for the 2026-08-15 America/Chicago run of [`authenticated-smoke-runbook.md`](authenticated-smoke-runbook.md).

**Cursor and Codex must not execute the runbook against production.** This file is the place the founder records what happened so a later reviewer can determine pass/fail without memory.

Evidence must be sufficient to establish pass/fail while remaining sanitized for a public repository.

`docs/status/CURRENT.md` authenticated-smoke row may change from Deferred to Passed only in a later founder-authorized closeout cycle, after this file shows Overall = Pass with all 16 Pass. That flip is not this cycle. Do not edit `CURRENT.md`.

---

## Header (founder fills after the run)

| Field | Value |
| --- | --- |
| Production origin | `PRODUCTION_APP_ORIGIN` |
| Client mailbox label (not the address) | Access client test |
| Staff mailbox label (not the address) | gc_delivery_ops seat |
| Run started (America/Chicago) | 2026-08-15 (America/Chicago) |
| Run ended (America/Chicago) | 2026-08-15 (America/Chicago) |
| Overall | Pass |
| Founder sign-off (name / date) | Adam Carpenter / 2026-08-15 |

---

## Do not record or commit

- actual mailbox addresses
- organization names if non-public
- production user IDs
- production title IDs
- auth/magic-link URLs
- tokens
- cookies/session values
- URL query strings containing identifiers
- internal database identifiers
- secret/config values
- stack traces
- raw sensitive error payloads
- production data copied from screens

For check **#10**, committed evidence must be of the form:

> Title stub successfully created; production identifier retained privately by founder and not committed to the repository.

If a failure requires preserving sensitive diagnostic evidence, record only a sanitized summary in the repository and retain the detailed evidence outside the repository.

Sanitized evidence may include: page title, redirect target path (no query string with identifiers), and a generic error class (for example “auth callback failed”, “error page”, “operator page rendered for client”).

---

## Checks

| Check id | Path | Role | Date-time (America/Chicago) | Result | Sanitized evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/login` → `/auth/callback` | client Access | 2026-08-15 (America/Chicago) | Pass | Authenticated session established after magic-link callback. App chrome present; not the signed-out login form. | |
| 2 | `/onboarding/organization` | client Access | 2026-08-15 (America/Chicago) | Pass | Pass; precondition already met; no new organization created. | organization already existed |
| 3 | `/onboarding/plan` (Access clickwrap) | client Access | 2026-08-15 (America/Chicago) | Pass | Pass; precondition already met; Access already accepted; no payment surface opened. | Access agreement already accepted |
| 4 | `/` | client Access | 2026-08-15 (America/Chicago) | Pass | Dashboard loaded in the app shell without an error page. | |
| 5 | `/titles` | client Access | 2026-08-15 (America/Chicago) | Pass | Page heading Titles loaded without an error page. | |
| 6 | `/deliveries` | client Access | 2026-08-15 (America/Chicago) | Pass | Page heading Deliveries loaded without an error page. | |
| 7 | `/catalog-health` | client Access | 2026-08-15 (America/Chicago) | Pass | Page heading Catalog Health loaded without an error page. | |
| 8 | `/messages` | client Access | 2026-08-15 (America/Chicago) | Pass | Page heading Messages loaded without an error page. | |
| 9 | `/account/agreements` | client Access | 2026-08-15 (America/Chicago) | Pass | Page heading Agreements loaded. Access assent present. Agreement text, hashes, and document identifiers not recorded. | |
| 10 | `/titles` (create stub) | client Access (Operate) | 2026-08-15 (America/Chicago) | Pass | Title stub successfully created; production identifier retained privately by founder and not committed to the repository. | |
| 11 | Sign out → `/login` | client Access | 2026-08-15 (America/Chicago) | Pass | Session ended. Signed-out Sign in form on /login. | |
| 12 | `/login` → `/auth/callback` | gc_staff | 2026-08-15 (America/Chicago) | Pass | Authenticated staff session confirmed by successfully loading /queue. | |
| 13 | `/queue` | gc_staff | 2026-08-15 (America/Chicago) | Pass | Page heading Queue loaded without an error page. | |
| 14 | `/gc/deliveries` | gc_staff | 2026-08-15 (America/Chicago) | Pass | Page heading Deliveries loaded without an error page. Load only. | |
| 15 | `/vendors` | gc_staff | 2026-08-15 (America/Chicago) | Pass | Page heading Vendors loaded without an error page. Load only. No vendor names recorded. | |
| 16 | `/queue`, `/gc/deliveries`, `/vendors` | unauthenticated-or-client | 2026-08-15 (America/Chicago) | Pass | /queue, /gc/deliveries, and /vendors redirected the Access-tier client to the dashboard; no operator page rendered. | |
