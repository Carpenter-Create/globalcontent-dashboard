# Security work — where everything actually stands

*Generated 2026-07-27, from live checks against local and production, not from memory.*
*Supersedes nothing; the audit findings files remain the record of what was found and how.*

---

## 1. Databases

| | Local | Production (`uevsculwzwlhxeamagwg`) |
|---|---|---|
| Migrations applied | **40** | **33** |
| High-water | `20260726000900` | `20260726000700` |
| Postgres | 17.6 | 17.6.1.147 |

**Production has exactly two of the nine `20260726*` migrations: `000600` and `000700`.**

`000700` reached production by mistake — a `db push` run from a feature branch picked it up
alongside `000600`. It is additive, GC-only, tested, and its code shipped in PR #52, so the
resolution was to merge rather than revert. Recorded because it is the reason the two ledgers
diverge.

### Applied to LOCAL only — the seven pending

| Migration | What it does |
|---|---|
| `000100` | Chain-of-title gate on 4 delivery RPCs |
| `000200` | `export_records` integrity — CHECK + trigger + RPC validation |
| `000300` | Revoke the four residual grants; stop the default-privilege decay |
| `000400` | Revoke PUBLIC execute across all 8 affected functions |
| `000500` | Last-`account_owner` guard |
| `000800` | Scope the `portal_sessions` audit; redact the token hash |
| `000900` | `view_financial` capability (D1) |

**`000300` and `000600` are a pair.** `000300` alone on a current Supabase image leaves a
database with **no DML** — the four privileges it revokes are the only ones a current image
grants. `000600` is already in production, so the pairing is satisfied there. Both headers
carry the dependency.

### Rollback point

`~/gc-dumps/prod-20260727T042628Z.dump`, verified at all three levels: TOC readable
(34 policies / 107 ACLs), restored into `gc_prod_verify`, and 26 tables / 34 policies /
26 RLS-on / 33 ledger rows all matching production **including the grant string**.
**Row M9 closed.** PITR deliberately not purchased at zero clients.

*A dump is a point, not a window. It protects against the migrations taken before it and
nothing after, and it does not cover S3.*

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

---

## 3. Committed and unmerged

| Branch | Ahead | Contains |
|---|---|---|
| `integration/migration-batch` | 4 | The 7 pending migrations, repaired pgTAP fixtures + negative tests, harness fixes, the scoped `source_documents` item |
| `fix/audit-scope-and-drift-symmetry` (**PR #53**) | 3 | `000800`, symmetric drift check, C-group harness |
| `security-remediation-2026-07-26` | 12 | Original batch authoring; content now carried onto `integration/migration-batch`. **Superseded — do not merge both** |

**PR #53 overlaps `integration/migration-batch`** (both carry `000800`). Merge one, rebase the
other.

---

## 4. Test and control state

| | |
|---|---|
| pgTAP | **313 tests, 23 files, PASS** (was 271 before tonight) |
| B3 cross-org isolation | **exit 0 · 140 pass · 0 fail · 0 vacuous · 0 inconclusive** · baseline **empty** |
| L7 chain-of-title | 10 GATED · 1 UNGATED (deliberate) · 2 SKIPPED (declared unproven) |
| App | typecheck clean · 83/83 · build succeeds |
| `pnpm audit --audit-level high` | exit 0 |

`isolation` is green but **not registered as a required check** — the L7 step is still
`continue-on-error` until `000100` reaches production.

---

## 5. Open, with reasons

| Item | Why it is open |
|---|---|
| **L7 Q2d** — `create_screener_link` ungated on unreviewed titles | Deliberate. Screening is *how* review is performed. The RPC is `gc_staff`-only — verified: a client `account_owner` on their own draft title is refused `Not authorized`. A narrower "must be submitted" floor is written into `000100` as an unapplied comment |
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
| **Register `isolation` as required** | When `000100` reaches production and the L7 step flips to blocking |
| **Explicit grants, tightening pass** | `000600` reproduces today's privileges exactly. Narrowing them to what each policy admits is a separate reviewable change |
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
| Migrations | **Claude does not apply anything to production.** Command handed over, run from a clean `main` checkout |

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
