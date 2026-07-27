# Security work — where everything actually stands

*Generated 2026-07-27; refreshed after the `20260726*` batch reached production. All figures from
live checks.*
*Supersedes nothing; the audit findings files remain the record of what was found and how.*

---

## 1. Databases

| | Local | Production (`uevsculwzwlhxeamagwg`) |
|---|---|---|
| Migrations applied | **40** | **40** |
| High-water | `20260726000900` | `20260726000900` |
| Postgres | 17.6 | 17.6.1.147 |
| Tables / policies / RLS-on | 27 / 35 / 27 | 27 / 35 / 27 |

**The ledgers agree. All nine `20260726*` migrations are in production.**

The seven pending ones went up together on 2026-07-27 via `npx supabase db push --linked
--include-all`, run by hand from a clean `main` checkout at `2aeca63`. `--include-all` was
required because `000700` had reached production out of order earlier that night, leaving the
remote high-water mark above five of the seven. The flag was rehearsed first against a rebuilt
project matching production's then-state (33 migrations, 26 tables); all seven applied clean and
the end state matched local on every invariant. The real run printed exactly the expected seven —
`000100`, `000200`, `000300`, `000400`, `000500`, `000800`, `000900` — and every in-migration
assertion fired.

`000700` had reached production by mistake — a `db push` run from a feature branch picked it up
alongside `000600`. Additive, GC-only, tested, and its code shipped in PR #52, so the resolution
was to merge rather than revert. Recorded because it is why `--include-all` was needed at all.

**`000300` and `000600` were a pair.** `000300` alone on a current Supabase image leaves a
database with **no DML** — the four privileges it revokes are the only ones a current image
grants. `000600` was already in production, so the pairing held. Verified after the fact, not
assumed: `authenticated` retains SELECT on all 27 tables (check C1n below).

### End state verified directly — not from the ledger

`scripts/security/verify-prod-end-state.sql` — 24 catalog checks, read-only, run against
production and against local for comparison. **Both: 24/24 PASS, no differences** except row
counts (production 3 orgs, local 79).

A ledger row says a file *ran*; it does not say its effect *survived* a later file in the same
batch. `000900` does `create or replace function public.member_can(...)` after `000400` revoked
PUBLIC execute from it — precisely the operation that would silently restore the grant. Check C5
asks the catalog, and the answer is that it did not.

Four of the 24 rows are **negative controls**, because a check whose pass condition is "count = 0"
also passes when it examines nothing. They fired in production: C1n = 27 tables still readable,
C3n = 3085 pg_catalog functions matched by the same PUBLIC-grant predicate, C3s = 44 functions
actually examined in `public`, C17n = the gate pattern does *not* match `create_title`. The zeros
are examined zeros.

Covered: the four residual grants gone (C1) and the default-privilege decay stopped (C2) · no
function retains PUBLIC execute (C3) while `member_can`/`is_gc_staff`/`gc_check_digit` keep the
grants 21 RLS policies depend on (C4, C6n) · trigger functions executable by nobody (C6) ·
`organization_payout_details` exists with RLS and the payout columns gone from `organizations`
(C7–C11) · `view_financial` excludes `viewer` and `delivery_ops` in the function body, not just
the policy text (C12–C14) · `create_delivery` and `record_export` gated, plus
`set_delivery_status` and `create_portal_link` (C15–C17).

*One correction to `000900`'s own header: it says "all 66 orgs have all four NULL." That figure
was local. Production has 3 orgs. Its actual claim — the move transfers zero values — holds
(C10: 0 populated).*

### Rollback point

`~/gc-dumps/prod-20260727T051203Z.dump`, verified, taken **before** the batch — so it restores
production to the 33-migration state, not to today's. **Row M9 closed.** PITR deliberately not
purchased at zero clients.

*A dump is a point, not a window. It protects against the migrations taken before it and
nothing after, and it does not cover S3.*

**This dump is now seven migrations behind the live schema** — it was taken after `000600` and
`000700` were already in production, and before the batch. Restoring it today would undo all
seven. **Take a fresh one before the next batch.**

---

## 2. Merged to `main` and deployed

| | |
|---|---|
| Dependency bumps | `next` 16.2.12 — **middleware-bypass advisory closed in production**, verified live against `app.globalcontent.co` |
| CI enforcement | `ci.yml` (`checks` + `isolation`), CODEOWNERS, CLI pinned to 2.102.0 |
| Screener split | `gc_staff` keeps the master fallback; clients get dedicated screeners only; TTL 6h → 2h |
| Kind filter | `/api/assets/url` allow-list; UI controls hidden where the route refuses |
| Explicit grants | `000600` — the DR fix |
| Session revocation | `000700` + the staff control |
| The `20260726*` batch | All nine in production. End state verified against the catalog, 24/24 |
| Branch protection | `main` protected. `isolation` a **required status check**, `enforce_admins` on, force-push and deletion off |

---

## 3. Branch state — resolved

All security work is **merged to `main`**. The three overlapping branches are retired.

| Branch | Outcome |
|---|---|
| `integration/migration-batch` | **Merged** (PR #54). Carried everything |
| `fix/audit-scope-and-drift-symmetry` | PR #53 **closed as superseded**. Its two unique files were carried across first |
| `security-remediation-2026-07-26` | Retired. Content verified present on `main` |
| `security-audit-2026-07-26` | Retired. Content verified present on `main` |

All four were **pushed to `origin` before local deletion** and remain recoverable.

**What verifying the diffs caught.** The four audit findings documents —
`security-audit-findings.md`, `-part-2`, `-part-3`, `out-of-repo-results.md` — existed
**only on unmerged branches** and were not on `main`. Deleting `security-remediation` as
originally planned would have destroyed the record of all three audit passes. They are now on
`main`. Verified after merge: 0 files on any retired branch are absent from `main`.

## 4. Test and control state

| | |
|---|---|
| pgTAP | **314 tests, 23 files, PASS**, exit 0 |
| B3 cross-org isolation | **exit 0 · 140 pass · 0 fail · 0 vacuous · 0 inconclusive** · baseline **empty** |
| L7 chain-of-title | **exit 0** · 10 GATED · 1 UNGATED (Q2d, baselined) · 2 SKIPPED (declared unproven) |
| Production end state | `verify-prod-end-state.sql` **24/24 PASS**, 4 negative controls fired |
| App | typecheck clean · 83/83 · build succeeds |
| `pnpm audit --audit-level high` | exit 0 |

**`isolation` is now a required status check on `main`, and every step in it is blocking.**
The L7 step lost its `continue-on-error` when `000100` reached production.

Flipping it needed one change, because L7 exited 1 on *any* ungated path and Q2d is a decided
exception — so making the step blocking as-written would have turned `main` red on the next push.
L7 now uses the same baseline mechanism B3 already had: `KNOWN_OPEN` holds Q2d with its reason and
the change that removes it, anything outside the baseline fails the build, and a baselined path
that starts passing is reported loudly so the entry gets trimmed. Verified both ways — exit 0 as
configured, exit 1 with the baseline emptied.

The gate also fails on a **new** SKIP and on **zero** measured GATED paths. A skip is not a pass,
and a harness that seeds nothing must not report success.

---

## 5. Open, with reasons

| Item | Why it is open |
|---|---|
| **L7 Q2d** — `create_screener_link` ungated on unreviewed titles | Deliberate, and now **baselined in the L7 harness** (`KNOWN_OPEN`) rather than left to make the gate red. Screening is *how* review is performed. The RPC is `gc_staff`-only — verified: a client `account_owner` on their own draft title is refused `Not authorized`. A narrower "must be submitted" floor is written into `000100` as an unapplied comment; applying it means trimming the baseline entry, which the harness will prompt for on its own |
| **A6** — no account-closure or deletion path | Never built. Widened tonight: `portal_sessions` audit rows carry a vendor contact's identity with `org_id NULL`, so an org-scoped purge would miss them *by construction* |
| **`pnpm lint`** — 841 errors / 8727 warnings | All pre-existing. Advisory in CI so the gate is not red on arrival |
| **`brace-expansion`** high advisory | Unfixable in place — the patch exists only in 5.0.8, and forcing it breaks ESLint and the `.xlsx` export path. Declared in `auditConfig.ignoreGhsas` |
| **`uuid` moderate** | Three-major jump on a transitive dep of the export engine. Below the `high` gate |
| **`migration-drift.yml` secrets** | Not set. The workflow no-ops. Blocked on the production-vs-staging decision — and neither secret can be scoped to schema-read-only |
| **Section I** — console items | Untouched. **I10 (preview deployment protection) first** |
| **Sections J/L/M/O for the other two repos** | `globalcontent-web` and `24frame` have had no pass at all |

---

## 6. Scheduled, with triggers

| Item | Trigger |
|---|---|
| **`source_documents` tier/pricing separation** — `docs/scheduled/source-documents-tier-separation.md` | **Before counsel's agreement text lands.** `renderAgreement()` interpolates `TIER_META`; today the placeholder body has no pricing, but real text turns a latent duplication into a live disclosure — and it arrives as a *content* change, so CI will not flag it |
| **Dedicated screener pipeline** (MediaConvert watermark + proxy) | Before onboarding the first client. Until then clients see no in-app preview and staff review is unaffected. Needs per-org concurrency caps (row E9) or one client can queue unbounded transcode spend |
| **`member_can` follow-up: `source_documents`** | With the item above |
| **Explicit grants, tightening pass** | `000600` reproduces today's privileges exactly. Narrowing them to what each policy admits is a separate reviewable change |
| **Fresh production dump** | Before the next migration batch. The current one predates the seven applied on 2026-07-27 |
| **Revisit PITR** | When the first client uploads a title. A dump stops being proportionate the moment there is data you cannot recreate |
| **Re-run both matrices** | Before each launch (row H4) |

---

## 7. Decisions made tonight

| | |
|---|---|
| **D1** | Restrict. `viewer` **and** `delivery_ops` excluded from financial reads. Built |
| **D2** | `share_token` stays plaintext — an identifier, not a bearer credential; the OTP+session chain gates content |
| **D3** | Implement session revocation. Built, with a staff control |
| **D4** | Hard block on the delivery gate. Built |
| PITR | Not purchased. Verified dump instead |
| `audit_log` | Gate the read, never redact the write |
| Migrations | **Claude does not apply anything to production.** Command handed over, run from a clean `main` checkout. Unchanged by the `--include-all` run — the rehearsal, the file-list prediction and the post-hoc verification were Claude's; the apply was not. Verification is read-only catalog SELECTs, which is a different class of act and stays on this side of the line |
| Branch protection | `enforce_admins` **on**. A gate the only committer can walk around is the `revoke ... from anon` mistake in a different costume |

---

## 8. Known process gaps

1. **`db push` reads the working tree, not a branch.** That is how `000700` reached production
   early. Always `git checkout main && git pull && git status` first, and read the file list
   the CLI prints before confirming.
2. **`migration-drift.yml` was blind to prod being *ahead*.** Fixed on PR #53, unmerged.
3. **Local, CI and production must stay on the same Supabase CLI.** A newer image drops the
   default table grants; on `latest` the schema comes up with **0 of 26 tables readable**.
   Pinned to 2.102.0 in CI. This is why `000600` exists.
4. **Six harness self-corrections tonight** — the PostgREST `200 []` false negative, vacuous
   zero-row reads, the injected-token overwrite with silently no-op'd preconditions, the
   `verifyOtp` type error, Q2b/Q2c vanishing, and W5's broken verifier. Treat a clean first
   result from any new harness as unproven until its negative control is checked.
   *Held on the seventh:* `verify-prod-end-state.sql` failed to parse on first run, then read
   24/24 against local before it was pointed at production, and carries its controls as numbered
   rows so a future reader cannot mistake an unexamined zero for a clean one.
5. **The migration ledger is not the end state.** `schema_migrations` records that a file ran.
   It cannot record that a *later* file in the same batch undid it — and `create or replace
   function` is exactly that hazard, since it is the normal way to edit a function and it sits in
   the same batch as the migration that revoked the function's PUBLIC grant. Verify the objects.
6. **A gate that cannot fail is not a gate, and a gate that is red on arrival gets deleted.**
   Both failure modes were live tonight: L7 was `continue-on-error` (could not fail) and exited 1
   on a decided exception (would be red the moment it could). The resolution is neither — it is a
   baseline that names each accepted finding and the change that retires it. Check that a new
   gate fails by *making* it fail before trusting that it passes.
