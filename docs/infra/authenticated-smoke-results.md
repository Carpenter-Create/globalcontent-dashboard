# Authenticated production smoke — results

Empty evidence log for a founder-executed run of [`authenticated-smoke-runbook.md`](authenticated-smoke-runbook.md).

**Cursor and Codex must not execute the runbook against production.** This file is the place the founder records what happened so a later reviewer can determine pass/fail without memory.

Evidence must be sufficient to establish pass/fail while remaining sanitized for a public repository.

`docs/status/CURRENT.md` authenticated-smoke row may change from Deferred to Passed only in a later founder-authorized closeout cycle, after this file shows Overall = Pass with all 16 Pass. That flip is not this cycle. Do not edit `CURRENT.md`.

---

## Header (founder fills after the run)

| Field | Value |
| --- | --- |
| Production origin | `PRODUCTION_APP_ORIGIN` (or a hostname the founder already treats as public) |
| Client mailbox label (not the address) | |
| Staff mailbox label (not the address) | |
| Run started (America/Chicago) | |
| Run ended (America/Chicago) | |
| Overall | Pass only if 1–16 are all Pass. Any Fail or Blocked = not a complete successful run. |
| Founder sign-off (name / date) | |

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
| 1 | `/login` → `/auth/callback` | client Access | | Pass \| Fail \| Blocked | | |
| 2 | `/onboarding/organization` | client Access | | Pass \| Fail \| Blocked | | |
| 3 | `/onboarding/plan` (Access clickwrap) | client Access | | Pass \| Fail \| Blocked | | |
| 4 | `/` | client Access | | Pass \| Fail \| Blocked | | |
| 5 | `/titles` | client Access | | Pass \| Fail \| Blocked | | |
| 6 | `/deliveries` | client Access | | Pass \| Fail \| Blocked | | |
| 7 | `/catalog-health` | client Access | | Pass \| Fail \| Blocked | | |
| 8 | `/messages` | client Access | | Pass \| Fail \| Blocked | | |
| 9 | `/account/agreements` | client Access | | Pass \| Fail \| Blocked | | |
| 10 | `/titles` (create stub) | client Access (Operate) | | Pass \| Fail \| Blocked | | |
| 11 | Sign out → `/login` | client Access | | Pass \| Fail \| Blocked | | |
| 12 | `/login` → `/auth/callback` | gc_staff | | Pass \| Fail \| Blocked | | |
| 13 | `/queue` | gc_staff | | Pass \| Fail \| Blocked | | |
| 14 | `/gc/deliveries` | gc_staff | | Pass \| Fail \| Blocked | | |
| 15 | `/vendors` | gc_staff | | Pass \| Fail \| Blocked | | |
| 16 | `/queue`, `/gc/deliveries`, `/vendors` | unauthenticated-or-client | | Pass \| Fail \| Blocked | | |
