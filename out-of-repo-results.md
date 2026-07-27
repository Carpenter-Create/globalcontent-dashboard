# Out-of-Repo Checklist — Results

*Companion record for `out-of-repo-checklist.md`. Closes out `security-remediation-plan.md` §4.*

**Repo:** `Carpenter-Create/globalcontent-dashboard` · default branch `main`
**Branch in progress:** `security-remediation-2026-07-26`
**Started:** 2026-07-26

Legend: ☐ not started · ⏳ in progress / blocked · ✅ done · ⚠️ done with a caveat · ⛔ blocked on a decision

---

## Part A — GitHub settings

| Item | Status | Result |
|---|---|---|
| A1. Get the commands | ✅ | `ci.yml` written (commit `28c1fea`). Job names confirmed: **`checks`** and **`isolation`**. Commands below. |
| A2. Set the two secrets | ⛔ | Awaiting the production-vs-staging decision. Commands drafted below, values not supplied. |
| A3. Add the required check | ⛔ | Unblocked on the name; still needs `ci.yml` merged to `main` and run once. See the sequencing note. |
| A4. Add CODEOWNERS | ✅ | `.github/CODEOWNERS` written (commit `28c1fea`). `@acarpcreate` on everything, with Tier-3 paths enumerated. **Enforces nothing until branch protection enables "Require review from Code Owners".** |

### A1 result

`ci.yml` did not exist when this started — it is remediation item 2.4, since completed. The job
names are now facts, not proposals, read from `.github/workflows/ci.yml:30-31` and `:68-69`:

| Job id | `name:` | Contents |
|---|---|---|
| `checks` | `checks` | typecheck · tests · `pnpm audit --audit-level high` · lint (advisory) |
| `isolation` | **`isolation`** | `supabase start` · pgTAP (275 assertions) · **B3 harness** · L7 harness |

**B3 runs inside `isolation`.** That is the name to register.

**Sequencing constraint, not in the checklist:** GitHub only lets you require a status check it has
already observed on the repo. A required check cannot be registered for a job that has never run.
The real order is:

> merge `ci.yml` to `main` → let it run once → *then* A3 → then the read-back

Registering first either errors or silently records a name that never fires — the same failure mode
as the `can_deliver` revoke.

```bash
# --- A3: require the isolation job on main (run AFTER ci.yml has run once) -------
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
| `SUPABASE_ACCESS_TOKEN` | lines 41, 57 | Supabase account access token (Account → Access Tokens). Account-scoped — there is no schema-read-only variant. |
| `SUPABASE_DB_PASSWORD` | lines 42, 58 | The target project's database password. Full DB credential. |

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
| B1. Anthropic spend cap + alert | ☐ | |
| B2. Supabase PITR (3 projects) | ☐ | |
| B3. RLS enabled in production | ☐ | |
| B4. AWS budget alarms | ☐ | |
| B5. Stripe webhook live mode | ⛔ | **No destinations in live mode, deliberately** — still testing, UI not built. Reclassified as a **launch blocker**, not an open finding: see `SECURITY-STATUS.md` §6. Must be registered before the first real payment, or a customer is charged and `finalize_paid_signup` never runs |
| B6. Vercel preview protection | ☐ | |

---

## Part C — Auth failure cases

| Item | Status | Result |
|---|---|---|
| C — scoping question | ⛔ | Not started, per instruction. Blocked on: does a hosted non-production Supabase project exist? |

---

## Part D — Decisions (owner's, not recorded as done/not-done)

| # | Decision | Answer |
|---|---|---|
| D1 | Does `viewer` keep billing access? | *unanswered* |
| D2 | Does `share_token` stay plaintext? | *unanswered* |
| D3 | Session revocation — implement or remove? | *unanswered* |
| D4 | Delivery gate — hard block or warn-and-log? | *unanswered* |

D4 blocks remediation §2.2. D2 and D3 block §2.5.
