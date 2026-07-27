# Out-of-Repo Checklist — Results

*Companion record for `out-of-repo-checklist.md`. Closes out `security-remediation-plan.md` §4.*

**Repo:** `Carpenter-Create/globalcontent-dashboard` · default branch `main`
**Started:** 2026-07-26 · **Reconciled:** 2026-07-27, against the state after the `20260726*`
batch reached production

> The branch this was started on (`security-remediation-2026-07-26`) is retired; all of its
> content is on `main`. See `SECURITY-STATUS.md` §3.
>
> **`SECURITY-STATUS.md` is the live picture. This file is the out-of-repo audit record** — what
> was checked outside the codebase and what came back. Where they overlap, they are reconciled;
> where a row here is closed, it names the evidence rather than restating it.

Legend: ☐ not started · ⏳ in progress / blocked · ✅ done · ⚠️ done with a caveat · ⛔ blocked on a
decision · **⏸ deliberately deferred, with a named trigger**

*`⏸` was added on reconciliation. Two rows were sitting under `⛔` while not actually being blocked
on anything — the decision had been made, and the decision was "not yet, and here is what changes
that." Filing a deliberate deferral as a blocker is how a launch gate reads as somebody else's
problem.*

---

## Part A — GitHub settings

| Item | Status | Result |
|---|---|---|
| A1. Get the commands | ✅ | `ci.yml` written (commit `28c1fea`). Job names confirmed: **`checks`** and **`isolation`**. Commands below. |
| A2. Set the two secrets | ⚠️ | **DONE ON 2026-07-22 — this row said "not supplied" for five days and was wrong.** `gh secret list` shows both `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, dated `2026-07-22T03:5x`, and the workflow has been running against **production** since. The production-vs-staging tradeoff below was therefore never a *pending* decision — it was already decided by action, pointing at prod. Two live consequences: `SUPABASE_ACCESS_TOKEN` is **no longer used by any workflow** and should be deleted; and because the `postgres` password is already stored, `drift_reader` is now a **rotation**, not an avoidance. |
| A3. Add the required check | ✅ | **Done 2026-07-27.** `main` had no protection at all until then. `isolation` is registered and `enforce_admins` is on. **The applied payload differs from the draft below — see A3 result.** |
| A4. Add CODEOWNERS | ⚠️ | `.github/CODEOWNERS` written (commit `28c1fea`). `@acarpcreate` on everything, with Tier-3 paths enumerated. **Still enforces nothing.** Branch protection now exists but sets `required_pull_request_reviews: null`, so "Require review from Code Owners" is off. Unchanged by A3 — see the note there. |

### A1 result

`ci.yml` did not exist when this started — it is remediation item 2.4, since completed. The job
names are now facts, not proposals, read from `.github/workflows/ci.yml:35-36` and `:73-74`
(`:30-31` / `:68-69` when this was written; the file has since gained comments):

| Job id | `name:` | Contents |
|---|---|---|
| `checks` | `checks` | typecheck · tests · `pnpm audit --audit-level high` · lint (advisory) |
| `isolation` | **`isolation`** | `supabase start` · pgTAP (**314** assertions, 23 files) · **B3 harness** · L7 harness |

**B3 runs inside `isolation`.** That is the name to register.

*Reconciled 2026-07-27: pgTAP was 275 when this was written. Every step in `isolation` is now
blocking — the L7 step lost `continue-on-error` when `20260726000100` reached production
(`SECURITY-STATUS.md` §4).*

**Sequencing constraint, not in the checklist:** GitHub only lets you require a status check it has
already observed on the repo. A required check cannot be registered for a job that has never run.
The real order is:

> merge `ci.yml` to `main` → let it run once → *then* A3 → then the read-back

Registering first either errors or silently records a name that never fires — the same failure mode
as the `can_deliver` revoke.

```bash
# --- A3 DRAFT — NOT what was applied. Kept for the reasoning; see "A3 result" below.
# --- require the isolation job on main (run AFTER ci.yml has run once) -----------
gh api -X PUT repos/Carpenter-Create/globalcontent-dashboard/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["isolation"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# --- A3 read-back: DO NOT SKIP -------------------------------------------------
gh api repos/Carpenter-Create/globalcontent-dashboard/branches/main/protection \
  --jq '{required_checks: .required_status_checks.contexts,
         strict: .required_status_checks.strict,
         code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
         approvals: .required_pull_request_reviews.required_approving_review_count}'
# Expect: required_checks == ["isolation"], code_owner_reviews == true
```

Two notes on that payload. `enforce_admins: false` means you can still merge past a red check as
the repo admin — set it `true` if you want the gate to bind you too. And
`require_code_owner_reviews: true` is what makes A4's CODEOWNERS file do anything at all; as a sole
founder you will also need `"required_approving_review_count": 0` or a second account, otherwise
you cannot approve your own PR and merges will block entirely.

### A3 result — applied 2026-07-27

The sequencing note above held exactly: `main` had **no protection object at all** until this was
run, so this created one rather than editing one. `ci.yml` had already merged and run, so the
`isolation` context was observable and registered without error.

**What was actually applied, and where it diverges from the draft:**

| Field | Draft | Applied | Why |
|---|---|---|---|
| `contexts` | `["isolation"]` | `["isolation"]` | — |
| `strict` | `true` | **`false`** | `strict` forces every PR to be up to date with `main` before merging. With one committer and no concurrent PRs it buys nothing and costs a rebase per merge |
| `enforce_admins` | `false` | **`true`** | Owner's call. A gate the only committer can walk around is decorative — the same failure mode as a `revoke` that never targeted `PUBLIC` |
| `required_pull_request_reviews` | 1 approval, code-owner reviews on | **`null`** | The sole-founder trap named above: with `enforce_admins: true` and a review requirement, nobody can approve and merges block entirely. Left off deliberately |
| `allow_force_pushes` / `allow_deletions` | `false` | `false` | GitHub's default for a new protection object |

Read back live, not assumed:

```json
{"contexts":["isolation"],"strict":false,"enforce_admins":true,
 "pr_reviews":null,"force_pushes":false,"deletions":false}
```

**The consequence for A4, stated so it is not lost:** `required_pull_request_reviews: null` means
CODEOWNERS still enforces nothing. That is the price of `enforce_admins: true` for a single-owner
repo — the check binds, the review does not. Revisit when there is a second committer.

**Verified in practice, not just by read-back.** Four PRs (#55–#58) went through this gate on
2026-07-27; each waited on `isolation` and none bypassed it. One local commit landed on `main` by
mistake during that run and was moved to a branch before any push — the protection was never
tested by a direct push, so treat "direct pushes are rejected" as configured-but-unexercised.

### A2 notes — decision needed before any command is emitted

`migration-drift.yml` needs two repo secrets, and **the project it compares against is not a secret**
— it is hardcoded at line 30:

```yaml
env:
  PROJECT_REF: uevsculwzwlhxeamagwg # GC dashboard PROD Supabase project
```

So "point it at staging" is a **workflow edit plus different secrets**, not just different secrets.
The two secrets themselves are:

| Secret | Used at | What it is |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | lines 41, 68 | Supabase account access token (Account → Access Tokens). Account-scoped — there is no schema-read-only variant. |
| `SUPABASE_DB_PASSWORD` | lines 42, 69 | The target project's database password. Full DB credential. |

*Reconciled 2026-07-27: the second occurrence moved from 57/58 to 68/69. `PROJECT_REF` is still
line 30.*

Neither can be narrowed to "read schema and nothing else", which is the condition the checklist sets
for pointing at production. Recorded here so the tradeoff is on the record either way.

```bash
# --- A2: NOT RUN. Values deliberately omitted; supply them yourself. ------------
# Decide production vs staging FIRST — see the tradeoff above.
gh secret set SUPABASE_ACCESS_TOKEN --repo Carpenter-Create/globalcontent-dashboard
gh secret set SUPABASE_DB_PASSWORD  --repo Carpenter-Create/globalcontent-dashboard
# Both prompt for the value on stdin rather than taking it as an argument, which keeps
# it out of shell history. Do not use --body.

# If you choose STAGING, the workflow also needs editing — the project is not a secret:
#   .github/workflows/migration-drift.yml:30   PROJECT_REF: uevsculwzwlhxeamagwg

# Read back which secrets exist (names and timestamps only; values are never readable):
gh secret list --repo Carpenter-Create/globalcontent-dashboard
```

---

## Part B — Console items

| Item | Status | Result |
|---|---|---|
| B1. Anthropic spend cap + alert | ☐ | Not started. Unchanged. |
| B2. Supabase PITR (3 projects) | ⏸ | **Decided, not done: PITR deliberately not purchased at zero clients.** A verified dump is the rollback point instead — `~/gc-dumps/prod-20260727T053612Z.dump`, verified at all three levels (`SECURITY-STATUS.md` §1). Reopens as a **launch blocker**, §6: a dump stops being proportionate the moment there is data you cannot recreate |
| B3. RLS enabled in production | ✅ | **Verified live 2026-07-27, against the catalog rather than the dashboard.** `27 tables / 35 policies / 27 RLS-enabled` in the production `public` schema — row I1 of `scripts/security/verify-prod-end-state.sql`, which read 24/24 PASS against production with four negative controls firing. Re-runnable: `npx supabase db query --linked -f scripts/security/verify-prod-end-state.sql` |
| B4. AWS budget alarms | ☐ | Not started. Unchanged. |
| B5. Stripe webhook live mode | ⏸ | **No destinations in live mode, deliberately** — still testing, UI not built. Reclassified as a **launch blocker**, not an open finding: see `SECURITY-STATUS.md` §6. Must be registered before the first real payment, or a customer is charged and `finalize_paid_signup` never runs |
| B6. Vercel preview protection | ☐ | Not started. This is Section I row **I10**, and `SECURITY-STATUS.md` §5 names it as the **first** console item to take when Section I is picked up |

---

## Part C — Auth failure cases

| Item | Status | Result |
|---|---|---|
| C — scoping question | ⛔ | Not started, per instruction. Blocked on: does a hosted non-production Supabase project exist? **Still unanswered — and it is the same blocker as A2.** Answering it once unblocks both the auth-failure work and `migration-drift.yml`. Worth deciding as one thing rather than twice |

---

## Part D — Decisions (owner's, not recorded as done/not-done)

**All four answered 2026-07-26 and shipped to production 2026-07-27.** Nothing in Part D is
blocking any longer.

| # | Decision | Answer | Shipped as |
|---|---|---|---|
| D1 | Does `viewer` keep billing access? | **No — restrict.** `viewer` *and* `delivery_ops` are both excluded from financial reads. A new `view_financial` capability admits `account_owner`, `accountant`, `legal` only | `20260726000900`. Payout columns moved off `organizations` to `organization_payout_details` because RLS cannot mask a column; `audit_log` gated by entity so `delivery_ops` keeps operational history |
| D2 | Does `share_token` stay plaintext? | **Yes.** It is an identifier, not a bearer credential — the OTP + session chain gates the content | No migration needed |
| D3 | Session revocation — implement or remove? | **Implement**, with a staff control | `20260726000700` + the staff control (PR #52). Audit scope tightened and the token hash redacted by `20260726000800` |
| D4 | Delivery gate — hard block or warn-and-log? | **Hard block** | `20260726000100`. Four RPCs gated; the L7 harness is now a blocking CI step proving 10 paths refused |

*Remediation §2.2 was blocked on D4 and §2.5 on D2/D3 — both unblocked and both complete.*

The one deliberate exception, so it is not mistaken for an oversight: **L7 Q2d**,
`create_screener_link` on a never-reviewed title, stays ungated because screening is *how*
chain-of-title review is performed. It is `gc_staff`-only and baselined by id in the harness, not
silently tolerated. `SECURITY-STATUS.md` §5.

---

## What is still open here — reconciled 2026-07-27

Read this before assuming any row above is current.

| | Item | Note |
|---|---|---|
| ⛔ | **A2 + Part C** | **One decision, not two: does a hosted non-production Supabase project exist?** A2 (`migration-drift.yml` secrets) and Part C (auth failure cases) are both waiting on it. Neither secret can be scoped to schema-read-only, which is the condition the checklist set for pointing at production — so this is a real tradeoff, not an oversight |
| ⚠️ | **A4** | CODEOWNERS enforces nothing. `required_pull_request_reviews: null` is the cost of `enforce_admins: true` on a single-owner repo. Revisit with a second committer |
| ⏸ | **B2, B5** | Launch blockers, both in `SECURITY-STATUS.md` §6. B5 is the one that costs money if missed |
| ☐ | **B1, B4, B6** | Console items, untouched. B6 is I10 and goes first |

**Closed since this file was written:** A3 (branch protection created, `isolation` required),
B3 (RLS verified live against the catalog), D1–D4 (all four decided and shipped).

*Two things this reconciliation caught that were not on anyone's list: the pgTAP count and three
sets of line references had gone stale, and `SECURITY-STATUS.md` §8 was still describing the
`migration-drift.yml` prod-ahead fix as unmerged when it has been on `main` since the
consolidation. Line numbers in a record like this rot silently — treat any `file:line` here as a
claim to re-check, not a fact.*
