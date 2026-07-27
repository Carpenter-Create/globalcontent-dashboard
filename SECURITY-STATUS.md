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

**Current — `~/gc-dumps/prod-20260727T053612Z.dump`**, taken 2026-07-27 00:36 local / 05:36Z,
**after** the batch. 369K. **Verified at all three levels. Row M9 closed on this file, not
inherited from the previous one.**

1. **TOC readable** — 705 entries, 35 policies / 111 ACLs.
2. **Restored** into throwaway `gc_prod_verify_053612` (PG 17.6 client inside the local
   container). 45 errors, all ignored and all platform-owned: `must be able to SET ROLE
   supabase_auth_admin` ×37 (the `auth` schema), `permission denied to change default
   privileges` ×6, `schema "public" already exists` ×1, `SET ROLE supabase_admin` ×1. Zero
   errors touching a `public` object.
3. **Compared count-by-count against live production** via
   `scripts/security/compare-schema-digest.sql`, as md5 digests so a one-byte difference in a
   single grant string cannot hide inside a matching count:

| | Production | Restored |
|---|---|---|
| tables / policies / RLS-on | 27 / 35 / 27 | **identical** |
| functions / triggers / indexes / constraints | 44 / 34 / 82 / 94 | **identical** |
| `table_acl_md5` — **the grant string** | `4c2a65a3…` | **identical** |
| `function_acl_md5` | `720477c6…` | **identical** |
| `policy_md5` (name, cmd, roles, `qual`, `with_check`) | `19a1263f…` | **identical** |
| `column_md5` (type, nullability, default) | `e83f4ae1…` | **identical** |
| `function_src_md5` | `4436dae9…` | **identical** |
| `rowcount_md5` / total rows | `7600b76f…` / 132 | **identical** |
| ledger | 40 rows, max `20260726000900` | **identical** |
| `default_acl_entries` | 6 | **3 — the only difference** |

The restored copy also reads **24/24 PASS** on `verify-prod-end-state.sql`, including
`C10: 0 populated / 3 orgs`.

⚠ **The one difference is real and worth knowing before you need it.** `pg_default_acl` does not
survive a restore performed by a non-superuser — those are the 6 `permission denied to change
default privileges` errors above. Production carries the *narrowed* defaults that
`20260726000300` installed; a restored database gets whatever the new cluster bootstraps with.
So a restore is not self-sufficient: **after any real restore, re-apply `000300`'s
`alter default privileges … revoke truncate, references, trigger, maintain`**, or the
default-privilege decay resumes on the next `CREATE TABLE`. Nothing else in the dump is affected —
the 27 existing tables carry their correct ACLs, which is what `table_acl_md5` matching proves.

*Two throwaway databases remain in the local container — `gc_prod_verify_053612` and the older
`gc_prod_verify`, 12 MB each. **Kept deliberately** (owner's call, 2026-07-27): they cost nothing,
and a terminate-and-remove chain is not worth running for 24 MB. Neither is load-bearing — the
verification reproduces from the dump plus `verify-prod-end-state.sql` and
`compare-schema-digest.sql`.*

*If they are ever cleared out: terminate the backends first. Removing an in-use database fails
with `database is being accessed by other users`, and that failure is quiet enough to read as
success — it already did once.*

**Superseded — `~/gc-dumps/prod-20260727T051203Z.dump`**, the pre-batch point. Restores production
to the 33-migration state. Keep it: it is the rollback target if the batch itself ever needs
undoing, which the current dump cannot do.

PITR deliberately not purchased at zero clients.

*A dump is a point, not a window. It protects against the migrations taken before it and
nothing after, and it does not cover S3.*

### Restoring without Docker — resolved

**`pg_restore` 17.10 is installed locally and reads `053612Z` directly: 705 / 35 / 111, matching
the figures above with no container involved.**

It did not, until 2026-07-27. Homebrew's linked client was 16.14, production writes archive
format 1.16, and `pg_restore -l` failed at the file header — `unsupported version (1.16) in file
header` — before reading a single object. For a few hours the only tool on this machine that
could open the backups lived inside the `supabase_db_globalcontent-dashboard` container, which is
plausibly the thing that is down on the day a restore is needed. Closed with:

```sh
brew install postgresql@17          # keg-only; leaves the linked 16.14 alone
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc && exec zsh
```

Re-confirm any dump the same way — a mismatch here means the dump, not the client:

```sh
pg_restore --version                                                       # 17.x
pg_restore -l ~/gc-dumps/prod-20260727T053612Z.dump | wc -l                # 705
pg_restore -l ~/gc-dumps/prod-20260727T053612Z.dump | grep -c ' POLICY '   # 35
pg_restore -l ~/gc-dumps/prod-20260727T053612Z.dump | grep -c ' ACL '      # 111
```

**The gap reopens on a server upgrade.** Production is Postgres 17.6.1 today; if it ever moves to
18, this client is behind again and the failure appears at the worst moment. The rule is that the
client must be at or above the server that wrote the dump — check it as part of any planned
Postgres upgrade, not afterwards.

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
| **`migration-drift.yml` — the check ran on the ACCESS TOKEN alone; the DB password does not work** | **Three corrections in one row, all found by running it rather than reading it.** (1) This file said "Not set. The workflow no-ops" for five days — false. Both secrets were set `2026-07-22T03:5x` and the check has been live against production, correctly failing the `05:08` push on 2026-07-27 when prod was behind by seven. (2) **`--linked` goes through the Management API and needs no database password** — verified by running it with `SUPABASE_DB_PASSWORD` unset: exit 0. So `SUPABASE_DB_PASSWORD` has sat in GitHub for five days **unused and never validated**. (3) It is also **wrong**: both `supabase --db-url` and a plain `psql` are refused by the pooler with `password authentication failed for user "postgres"`. Removing the account token therefore requires a database credential that does not exist in working form — which is why `drift_reader` comes first. **Schedule paused**; `push`→main and `workflow_dispatch` remain |
| **`gc_staff` is single-factor and role-agnostic** | **Two findings, one row — see `docs/scheduled/gc-staff-single-factor.md`.** (1) Authentication is email possession alone; no MFA exists anywhere in `src/`. `member_can` short-circuits to `true` on **every org** for any staff row, so one compromised mailbox is a whole-tenant compromise — 16 of 35 policies and 16 functions. (2) **Independently: `is_gc_staff` does not consult `gc_role` at all.** A `gc_viewer` can create a delivery, approve a title for delivery and mint a master-asset URL. The scope inversion shipped; the role separation did not. Scoped, costed, **not built** — the `aal2` migration must land *after* an enrollment flow or it locks out the only staff account (prod has 1 row) |
| **Section I** — console items | Untouched. **I10 (preview deployment protection) first** |
| **Sections J/L/M/O for the other two repos** | `globalcontent-web` and `24frame` have had no pass at all |

---

## 6. Launch blockers — before the first real client

**These gate onboarding. None of them is a defect today; each becomes one the moment a real
client exists.** Kept apart from the open findings in §5 because they are not things to fix —
they are things that must be true before the first paying customer, and a list of "open findings"
is where that distinction goes to die.

| Blocker | What happens if it is missed |
|---|---|
| **B5 — the live-mode Stripe webhook endpoint is not registered.** No destinations in live mode, deliberately: still testing, and the UI is not built | **A customer is charged and never provisioned.** `checkout.session.completed` is the only trigger for `finalize_paid_signup`, which writes `contract_terms` and flips the org to `active` (`src/app/api/stripe/webhook/route.ts:26-44`). With no live destination there is no delivery, no retry queue, and nothing in the app that notices — Stripe reports a successful payment while the org sits inactive with no terms row. Money in, no access, and no error anywhere on our side. **Register the live-mode endpoint before the first real payment, and confirm it with one live transaction rather than a test-mode event.** `finalize_paid_signup` is idempotent and Stripe retains events, so a missed charge is recoverable by resending the event from the dashboard — but only if someone notices, and nothing here surfaces it |
| **Dedicated screener pipeline** (MediaConvert watermark + proxy) | Clients see no in-app preview. Staff review is unaffected, so this blocks the client experience rather than delivery. Needs per-org concurrency caps (row E9) first, or one client can queue unbounded transcode spend |
| **`source_documents` tier/pricing separation** — `docs/scheduled/source-documents-tier-separation.md` | **Trigger is counsel's agreement text, which lands before launch.** `renderAgreement()` interpolates `TIER_META`; today's placeholder body has no pricing, but real text turns a latent duplication into a live disclosure — and it arrives as a *content* change, so CI will not flag it |
| **`member_can` follow-up: `source_documents`** | With the item above |
| **Revisit PITR** | A dump stops being proportionate the moment there is data you cannot recreate. Trigger is the first client upload, which is the same event as onboarding |
| **Re-run both matrices** | Before each launch (row H4) |

---

## 6b. Scheduled, with triggers

| Item | Trigger |
|---|---|
| **Explicit grants, tightening pass** | `000600` reproduces today's privileges exactly. Narrowing them to what each policy admits is a separate reviewable change |
| **`drift_reader` — set its password, then finish the chain** | **Role applied 2026-07-27, verified 10/10.** Remaining, in order: set the password interactively → set `SUPABASE_DB_PASSWORD` to it → dispatch to prove the pooler accepts a non-`postgres` role (**untested, and the one thing that could sink the approach**) → restore the hourly schedule → delete `SUPABASE_ACCESS_TOKEN`. `docs/scheduled/drift-reader-role.md` tracks the state |
| **Re-create `drift_reader` after any real restore** | Second item on the restore runbook, with `000300`. Roles are cluster-level and **do not survive a `pg_dump` restore** — same trap as `pg_default_acl`, and the drift check would start failing afterwards for a reason nobody connects to the restore |
| **GC-side role separation** | Independent of the MFA decision and cheaper. `is_gc_staff` ignores `gc_role` entirely (§5) |
| **Re-check the client/server version gap** | As part of any planned Postgres upgrade, not after. `pg_restore` 17.10 reads today's dumps; a move to Postgres 18 puts it behind again (§1) |
| **Re-apply `000300` after any real restore** | Immediately, as part of the restore runbook. `pg_default_acl` does not survive a non-superuser restore, so a restored database resumes the default-privilege decay until that migration's `alter default privileges` is re-run |

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
| **Exception, 2026-07-27 — `drift_reader`** | **First and only time Claude has written to production.** On explicit owner approval and instruction, after the exact SQL had been reviewed in `docs/scheduled/drift-reader-role.md`. Scope: one `CREATE ROLE` plus three grants, no schema object, no data, no RLS. Recorded because a standing rule with an unlogged exception is not a standing rule. The rule itself is unchanged — migrations still go through the owner |
| Branch protection | `enforce_admins` **on**. A gate the only committer can walk around is the `revoke ... from anon` mistake in a different costume |

---

## 8. Known process gaps

1. **`db push` reads the working tree, not a branch.** That is how `000700` reached production
   early. Always `git checkout main && git pull && git status` first, and read the file list
   the CLI prints before confirming.
2. **`migration-drift.yml` was blind to prod being *ahead*.** **Fixed and on `main`** — the
   workflow now reports both directions (`migration-drift.yml:79-105`), and treats *ahead* as an
   error even on a PR, because a migration applied to production with no file in the repo means
   the schema cannot be rebuilt. Originally written on PR #53, which was closed as superseded
   after its unique files were carried across; this note said "unmerged" until 2026-07-27, which
   was wrong. **It still no-ops** — the two secrets are unset (§5), so the fix is present but
   dormant. That is exactly the gap that let `000700` reach production unnoticed.
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
