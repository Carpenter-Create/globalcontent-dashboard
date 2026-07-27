# Global Content Dashboard — Security Coverage Matrix, Part 2 Results

**Repo:** `globalcontent-dashboard` (Tier 3) · **Branch:** `security-audit-2026-07-26`
**Date:** 2026-07-26 · **HEAD at audit:** `2759214` (the Part 1 commit)
**Scope:** Sections J, K, L, M, O assessed with Status + cited Evidence. Section N output as an
owner checklist, per the matrix's own instruction. **Part 1 rows are not re-audited here** — where a
Part 2 row depends on a Part 1 fact, it cites `security-audit-findings.md` rather than re-deriving it.

**Nothing was fixed, no migration was run, no source file was edited.** One file added:
`scripts/security/l7-chain-of-title-gate.mjs`.

## Method

| Method | Used for |
|---|---|
| Live test against running Postgres + PostgREST with real `gc_staff` and client JWTs | L7, L8, and the M4 cross-check |
| Live `psql` introspection (`pg_proc`, `pg_constraint`, `pg_trigger`, `proacl`) | L7 enumeration, L8, M3, M4 |
| Lockfile + `node_modules` traversal (552 distinct packages) | J1, J2, J3, J5 |
| Source and migration inspection with file:line citations | J4, J6, J7, J8, K, L1-L6, L9, M1, M2, M5, O |
| Live AWS read-only calls | M7 |

**Environment caveat carried forward from Part 1:** the local database is 4 migrations behind
`main` (applied high-water `20260721000200`; unapplied: `20260721000300`, `20260721000400`,
`20260722000100`, `20260722000200`). Live-DB rows (L7 execution, L8, M3, M4) therefore describe the
schema at `20260721000200`. Migration-*file* rows (M1, M2) cover all 31 files including the
unapplied ones. Where the two disagree I say so.

---

# PRIORITY FINDINGS

## L7 — Chain-of-title gate: **PARTIAL**. The status transition is airtight; the gate is not load-bearing downstream.

The matrix asks me to enumerate *every* path by which a title reaches deliverable status. Doing that
surfaced that "deliverable status" and "actually delivered" are two different things in this schema,
and only the first one is gated. I tested both:
`scripts/security/l7-chain-of-title-gate.mjs` → **7 GATED, 6 UNGATED**.

### Q1 — Can a title reach `in_delivery` without passing `review_title`? **No. Exhaustively enumerated.**

The enumeration is complete for in-database paths, by construction rather than by grep:

1. **Every function that writes `titles`** — `select proname from pg_proc where pg_get_functiondef(oid) ~* 'update\s+(public\.)?titles'`
   returns exactly six: `submit_title`, `review_title`, `set_release_date`, `set_screener_source`,
   `set_title_release_info`, `link_title_to_work_of`.
2. **Of those six, only two touch `status`** — the other four set `release_date`, `screener_source`,
   `release_type`/`original_release_date`, and `work_id` respectively (verified by extracting each
   `UPDATE … SET` clause from `pg_get_functiondef`). Tested live as Q1d: after calling all four, the
   title was still `draft`.
   - `submit_title` — `draft → in_review` only, guarded by `where … and status = 'draft'`, requires
     `member_can(…,'operate')` and all six required metadata fields
     (`supabase/migrations/20260719000700_export_and_submit_gate.sql:47-74`, the update at 67-69).
   - `review_title` — the gate itself. `in_review → in_delivery` (approve) or `→ draft` (reject),
     GC-only, and the row is selected with `where id = p_title_id and status = 'in_review'`
     (`supabase/migrations/20260719000100_title_reviews.sql:74-107`). Approving a title that was
     never submitted fails: tested as Q1c → `P0001 Title not found or not in review`.
3. **No trigger writes status** — the only three triggers on `titles` are `audit_titles` (`tg_audit`),
   `set_updated_at_titles`, and `titles_catalog_no_immutable`, none of which touches `status`.
4. **No direct write path exists** — `titles` has a SELECT policy only, so PostgREST `UPDATE` is
   denied. Tested from both sides: Q1a (client) and Q1b (**gc_staff**) both got `0 rows affected`
   with status unchanged. Worth stating explicitly: GC staff have no PostgREST write path to
   `titles.status` either, so the RPC really is the sole route.

**Conclusion for Q1: the only way into `in_delivery` is `review_title`, and `review_title` only
accepts a title already in `in_review`. That transition cannot be bypassed.**

### Q2 — Is `in_delivery` required before the title is actually delivered? **No. Nothing downstream checks it.**

I seeded a title that was **never submitted and never reviewed** (status `draft`) but otherwise
fully equipped — complete metadata, an active world SVOD grant, a master asset — so nothing could
fail for an unrelated reason. Then, as `gc_staff`:

| Step | Result |
|---|---|
| `create_delivery(title, vendor, grant, 'US')` | **SUCCEEDED** — delivery row created for a `draft` title |
| `set_delivery_status(delivery, 'live')` | **SUCCEEDED** — the title is now recorded live on a platform |
| `create_portal_link(delivery, master asset)` | **SUCCEEDED** — a master-download link, i.e. the vendor gets the actual master |
| `create_screener_link(title)` | **SUCCEEDED** |
| `record_export(vendor, [title], payload)` | **SUCCEEDED** |

None of those five RPCs reads `titles.status`. Confirmed by reading each body in full:

- `create_delivery` (`supabase/migrations/20260719000600_deliveries.sql:55-111`) checks
  `is_gc_staff`, ISO-2 territory, title exists, vendor active, **rule 12 grant coverage**, and the
  cross-client exclusivity block — a genuinely careful function — but never the title's status.
- `create_portal_link` (`supabase/migrations/20260720000100_portal_gate.sql:115-137`) checks
  `is_gc_staff`, that the delivery exists, and that the asset is a `master` on that delivery's title.
- `create_screener_link` (`supabase/migrations/20260720000300_screener_room.sql:51-78`, superseded by
  `20260721000300_screener_share_token.sql:31-68`) checks `is_gc_staff` and that a source asset exists.
- `record_export` (`supabase/migrations/20260719000700_export_and_submit_gate.sql:31-42`) checks
  `is_gc_staff` and nothing else at all.
- `/api/gc/export` (`src/app/api/gc/export/route.ts:28-29`) selects titles by id with no status filter.

**The only thing enforcing "reviewed before delivered" is a UI dropdown.**
`src/app/(app)/(operator)/gc/deliveries/page.tsx:29-31` filters the title picker to
`.in("status", ["in_delivery", "live"])`, with the comment *"A title reaches in_delivery only after
GC approves it"* — but `createDelivery` (`.../gc/deliveries/actions.ts:13-31`) passes the caller's
`titleId` straight into the RPC, which never re-checks. Per CLAUDE.md's own rule, *"A UI-only rule is
not a rule."*

### Scope this honestly

The actor who can bypass this is `gc_staff` — the same role that performs the review. **No client
role can reach any of these RPCs** (all five raise `Not authorized` for a non-staff caller; verified
in Part 1). So this is not a self-serve client escaping review; it is the absence of a server-side
interlock on the one human gate in the model, which means an operator mistake — picking the wrong
title id, a mis-scripted call, a future bulk tool — produces an unreviewed delivery with no error.
For a chain-of-title gate protecting against distributing content GC has no rights to, "the UI
usually shows the right list" is a weaker control than the rest of this schema demonstrates
elsewhere (`create_delivery`'s own rule-12 check is exactly the pattern this is missing).

### What I cannot enumerate

**Delivery itself happens outside this system.** CLAUDE.md specifies manual delivery: GC staff export
metadata and upload it to a vendor's own portal, or send a templated email. The email leg is not
built — `vendors.email_to` / `email_cc` / `email_template` are stored and editable
(`src/app/(app)/(operator)/vendors/actions.ts:63-65`) but **nothing sends them**; the only outbound
mail is the portal OTP and client notifications. So today the real delivery act is a human copying an
export into a vendor portal, which no code gate can constrain. My enumeration is exhaustive for
in-database status writes and in-repo call sites, and is necessarily incomplete for out-of-band
operator action. That limit is inherent to a manual-delivery model, and it is the reason the
in-system interlock matters more, not less.

### Also surfaced: four `title_status` values are unreachable

`draft`, `in_review`, `in_delivery` are the only values any code path writes. **`submitted`, `live`,
`takedown_requested`, and `taken_down` have no writer at all.** Two consequences worth noting: the
deliveries UI filter at `page.tsx:31` includes `"live"`, which is dead; and takedown — the state the
$197 Early Takedown Fee is priced against — has no state machine yet (see L4).

## K3 — Model output driving privileged actions: **N/A-NOT-BUILT.** There are no AI call sites.

Traced exhaustively rather than assumed, because K3 is only meaningful if K1 is non-empty:

- **No AI SDK.** `package.json` has no `@anthropic-ai/*`, `openai`, `@ai-sdk/*`, `langchain`, or any
  model client (Part 1 verified the full 21 + 9 dependency list).
- **No AI call site.** `grep -rin "anthropic|api\.anthropic|claude-|openai|gpt-|gemini|mistral|cohere|langchain|@ai-sdk|generateText|streamText"` over
  `src/` and `supabase/` returns **exactly three hits, all in one file**:
  `supabase/config.toml:100-101` (`openai_api_key = "env(OPENAI_API_KEY)"`) and a commented-out
  vector-bucket example at line 153. That block configures **Supabase Studio's local AI assistant in
  the local dev container** — it is not application code, is not deployed, and is inert unless
  `OPENAI_API_KEY` is set in the developer's shell.
- **No edge functions at all** — `supabase/` contains `config.toml`, `migrations`, `snippets`,
  `tests`. There is no `functions/` directory, so there is no serverless surface where a model call
  could hide.

Therefore **no model output writes to the DB, triggers an email, sets a status, or gates an
approval** — there is no model output. K3 is vacuously satisfied, which is not the same as designed
for, so here is the seam that already exists and what it commits you to:

| Seam in place today | Where | What K3 will require of it |
|---|---|---|
| `finding_source` enum = `('validator','ai')` | `supabase/migrations/20260720000600_findings.sql:16` | AI findings land in the **same table** as validator findings, distinguished only by this column. K3 turns on whether anything downstream acts on a row without checking `source`. |
| `reconcile_title_findings` auto-resolves `where … and source = 'validator'` | `20260720000600_findings.sql:94-96` | Already correct: the validator's reconcile pass cannot resolve or disturb an AI row. This is the single best-placed line in the AI seam. |
| `finding_sender` / `notification_sender` = `('gc_support','globee')` | `…000600:18`, `…000700:18` | `notifications.sender` defaults to `gc_support` and `create_notification` **hardcodes** `'gc_support'` (`20260720000700_notifications.sql`), so Globee has no push path — matching CLAUDE.md's "Globee never initiates". |
| "Globee AI assistant" marketed in onboarding | `src/lib/onboarding.ts:30-34` | Correctly labelled `status: "soon"`, so it is not claiming a live capability. |

The rule that will matter most when this is built is already written down and currently unviolated:
Globee must run with the user's JWT, never the service-role key. Note that the six service-role
routes identified in Part 1 (B6) are the pattern *not* to copy for it.

## M4 — Referential integrity across asset / rights / org / payout: **PARTIAL**

50 foreign keys enumerated from `pg_constraint`. The direct linkages are all present and correctly
typed, and the deletion semantics are uniformly protective — **zero `ON DELETE CASCADE` anywhere in
the schema** (checked via `confdeltype='c'` → empty). Everything is `RESTRICT`, or `SET NULL` on
`auth.users` back-references (`titles.created_by`, `assets.provided_by`, `rights_grants.created_by`,
`source_documents.provided_by`, `title_reviews.reviewer`), which is exactly the shape CLAUDE.md's
deletion rule demands: a departing employee cannot cascade a client's catalog.

The core chain is fully constrained:

```
organizations ←RESTRICT— titles ←RESTRICT— assets
                  ↑              ↖RESTRICT— rights_grants ←RESTRICT— deliveries —RESTRICT→ vendors
                  └──RESTRICT──── title_metadata            ↑
                                              portal_links ─┘ (delivery_id, asset_id, title_id all FK'd)
                                              portal_otps / portal_sessions → portal_links
                                              portal_access_events / screener_view_events → portal_links + portal_sessions
```

Three gaps, in descending order of consequence.

**(a) The denormalized `org_id` is not constrained to match the parent title's org.**
`assets`, `rights_grants`, `title_metadata`, `deliveries`, and `title_reviews` each carry both
`title_id → titles(id)` and `org_id → organizations(id)` as **two independent single-column FKs**.
Nothing at the database level requires them to agree. A row claiming
`title_id = <Org B's title>, org_id = <Org A>` satisfies every constraint. This matters because
**RLS reads the denormalized `org_id`**, not the title's — so such a row would appear in Org A's
tenant view while pointing at Org B's content.

It holds today only because writes are RPC-only and the RPCs check: `create_asset` and
`set_title_metadata` both carry
`if not exists (select 1 from titles where id = p_title_id and org_id = p_org_id) then raise`, and
`create_delivery` derives `v_org` **from the title** rather than accepting it
(`20260719000600_deliveries.sql:70`), which is the strongest of the three. So this is latent, not
exploitable — direct writes are revoked, and Part 1's B3 confirmed no client path reaches these
tables. The structural fix would be a composite FK, which needs `unique (id, org_id)` on `titles`;
that unique constraint does not currently exist (`titles` has only `titles_pkey`,
`titles_catalog_id_key`, `titles_catalog_no_key`).

**(b) `export_records.title_ids` is a bare `uuid[]` with no referential integrity — and it is a
provenance record.** `supabase/migrations/20260719000700_export_and_submit_gate.sql:16`. Postgres
cannot FK an array, and `record_export` validates nothing (lines 31-42). **Live-proven** as L7 test
Q2f: a `record_export` call with a randomly generated UUID was accepted, producing
`export_records` row `926d8d91…` that references title `23895836…`, which does not exist in
`titles`. This table is the immutable answer to "what did GC represent to this endpoint" — a
provenance row that can point at nothing is a provenance row you cannot rely on. The `payload` jsonb
holds the actual exported data, so the record is not empty, but the linkage is unverifiable.

**(c) `findings.entity_id` is polymorphic and unconstrained.**
`20260720000600_findings.sql` — `entity_type text` + `entity_id uuid` with no FK, and no constraint
tying the referenced title's org to `findings.org_id`. `reconcile_title_findings` does validate
title↔org before writing (`if not exists (select 1 from titles where id = p_title_id and org_id = p_org_id)`),
so the RPC is sound; the table is not self-defending. Same pattern, lower stakes than (b).

**Deliberately unconstrained, and correctly so:** `audit_log.org_id`, `audit_log.entity_id`,
`audit_log.actor` (an append-only log must outlive the rows it describes — a FK would make the log
deletable-by-proxy), and the `source_refs` / `raw` / `parsed` / `data` jsonb columns (rule 4
provenance pointers, unconstrainable by nature). I am not flagging these.

**No payout linkage exists to audit.** There are no payout, statement, or accounting-period tables —
the revenue module is deferred. `organizations.trolley_recipient_id` is a plain `text` column with no
counterpart table. When that module lands, (a) above is the pattern to fix first, because a payout
row carrying an unconstrained `org_id` is the version of this bug that moves money.

---

# FULL MATRIX

## J. Supply chain and repository integrity

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| J1 | Lockfile committed and consistent with `package.json` | **DONE** | `pnpm-lock.yaml` committed, 219,643 bytes, `lockfileVersion: '9.0'`. I parsed the `importers:` block and diffed it against `package.json` field by field: **21 dependencies + 9 devDependencies = 30 entries on both sides, every specifier identical, zero in one and not the other.** No `packageManager` field is pinned in `package.json`, so the pnpm version itself is not enforced — worth adding, but the lockfile is sound. |
| J2 | No dependencies from non-registry sources | **DONE** | Every one of the **646 `resolution:` entries in the lockfile is `{integrity: …}`** — i.e. a registry tarball with a subresource-integrity hash. Zero `{tarball: …}`, zero `{repo:/commit:}` git resolutions. Targeted grep for `git+`, `github.com`, `file:`, `link:` across the lockfile: **no matches**. No `.npmrc` exists, so no alternate registry is configured. |
| J3 | Dependency licenses inventoried | **DONE** — full list below | 552 distinct packages resolved from the pnpm store. Full histogram and every copyleft/unknown package enumerated in the **License inventory** section below. Headline: 444 MIT, 51 Apache-2.0, 28 ISC; **4 packages under reciprocal licenses and 1 with no license field**, all transitive, none authored by GC. |
| J4 | No vendored or pasted third-party code | **DONE** | No `vendor/`, `third_party/`, or `lib/vendor/` directory (`git ls-files` → none). **No file in `src/` or `supabase/` contains a foreign copyright header** — `grep -rln "Copyright (c)\|SPDX-License\|Licensed under the"` → no matches. The largest tracked file is `src/lib/supabase/database.types.ts` (1,845 lines), which is Supabase-generated and regenerated by the documented workflow, not pasted. The two bulk-data files are original and documented: `src/lib/territories.ts` (ISO 3166-1 alpha-2 → English name, with a comment explaining why the full official set is enumerated — rule 12) and `src/lib/languages.ts` (ISO 639-1 subset, marked provisional). Bare ISO code-to-name mappings are reference data, not third-party code. |
| J5 | Dependencies pinned or range-constrained deliberately | **DONE** | **No wildcard (`*`), no `latest`, no open `>=` range** anywhere in `package.json`. The four packages where version skew would actually break the app are **exactly pinned**: `next@16.2.9`, `react@19.2.4`, `react-dom@19.2.4`, `eslint-config-next@16.2.9`. Everything else is caret-ranged. Seven devDependencies use major-only carets — `@tailwindcss/postcss@^4`, `tailwindcss@^4`, `@types/node@^20`, `@types/react@^19`, `@types/react-dom@^19`, `eslint@^9`, `typescript@^5` — which is loose but reproducible because the lockfile pins the resolved versions and CI does not currently run an unlocked install. |
| J6 | CI workflow files reviewed for secret handling | **PARTIAL** | One workflow exists: `.github/workflows/migration-drift.yml`. Good: `permissions: contents: read` (line 26-27); **no `pull_request_target`** (trigger block at line 16 is `push` on `main`, `pull_request`, `workflow_dispatch`); secrets are passed as step `env` and never echoed — the guard step tests `[ -z "$SUPABASE_ACCESS_TOKEN" ]` without printing it (lines 40-49). Two things to weigh: (1) the workflow **authenticates to the production database from CI on every PR** that touches `supabase/migrations/**` — `supabase link --project-ref uevsculwzwlhxeamagwg` then `supabase db push --dry-run` with `SUPABASE_DB_PASSWORD` — so production DB credentials are exposed to any job running on a same-repo PR branch (fork PRs get no secrets, so those are safe by GitHub's model); (2) `echo "$out"` at line ~72 prints the CLI's raw output into the public build log — a dry run should only list migration filenames, but it is an unfiltered pipe from a tool talking to prod. Neither is a live leak; both are worth a second look before the secrets are actually set. |
| J7 | No build step fetches remote code | **DONE** | `package.json` has **no `preinstall`, `postinstall`, or `prepare` script** — the only scripts are `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `typecheck`. Dependency install scripts are **denied by default** (pnpm 11 behaviour) with an explicit, commented allowlist of exactly two native packages in `pnpm-workspace.yaml`: `allowBuilds: { sharp: true, unrs-resolver: true }`. That is the correct posture — a deny-by-default with two justified exceptions beats an implicit allow. No `curl`/`wget`/`fetch` appears in any build script. |
| J8 | Branch protection configuration | **MISSING (in-repo) / OUT-OF-REPO (GitHub side)** | `.github/` contains **exactly one file**, the workflow — **no `CODEOWNERS`**, no PR template, no `.github/settings.yml`. So the repo asserts no review requirement of its own. And there is no required-status-check candidate to attach: the single workflow is explicitly designed *not* to gate (its header says "deliberately NOT a build block"), and it only triggers on `supabase/migrations/**` paths, so a PR touching only `src/` runs **no CI at all**. **To check on GitHub:** Settings → Branches → whether `main` requires a PR, an approving review, and any status check — combined with the above, the repo-side evidence suggests nothing currently blocks a direct push to `main`. Cross-reference O3. |

### License inventory (J3, full list as requested)

552 distinct `name@version` packages across all direct and transitive dependencies, from
`node_modules/.pnpm/*/node_modules/*/package.json`.

| Count | License |
|---:|---|
| 444 | MIT |
| 51 | Apache-2.0 |
| 28 | ISC |
| 7 | BSD-2-Clause |
| 4 | BSD-3-Clause |
| 3 | **MPL-2.0** |
| 2 | MIT/X11 |
| 2 | Unlicense |
| 1 | (MIT AND Zlib) |
| 1 | **(MIT OR GPL-3.0-or-later)** |
| 1 | 0BSD |
| 1 | BlueOak-1.0.0 |
| 1 | CC-BY-4.0 |
| 1 | CC0-1.0 |
| 1 | **LGPL-3.0-or-later** |
| 1 | MIT-0 |
| 1 | Python-2.0 |
| 1 | SIL OPEN FONT LICENSE |
| 1 | **UNKNOWN (no license field)** |

**Every copyleft / reciprocal package, with where it is used:**

| Package | License | Dependency path | Assessment |
|---|---|---|---|
| `@img/sharp-libvips-darwin-arm64@1.2.4` | **LGPL-3.0-or-later** | `sharp@0.34.5` ← `next@16.2.9` (and `geist` → `next`) | The one to actually think about. A prebuilt libvips binary shipped for Next.js image optimization. LGPL permits use in a proprietary product **provided the library is dynamically linked and recipients can replace it** — which is satisfied here (separate `.node`/`.so` artifact, unmodified, installed from npm). The obligation is attribution plus making the libvips source available on request. Note the `-darwin-arm64` variant is a local-dev artifact; a Vercel build pulls `linux-x64`, same license. **Not a blocker; is an attribution obligation.** Also relevant to Part 1 H2 — `sharp` needs bumping to ≥ 0.35.0 for CVE-2026-33327 anyway. |
| `axe-core@4.12.1` | MPL-2.0 | `eslint-plugin-jsx-a11y` ← `eslint-config-next` ← **devDependencies** | Dev-only lint tooling, never shipped. MPL-2.0 is file-level copyleft and only bites if you modify its files. No obligation. |
| `lightningcss@1.32.0` + `lightningcss-darwin-arm64@1.32.0` | MPL-2.0 | `@tailwindcss/node` ← `@tailwindcss/postcss` (dev), and `vite` ← `vitest` (dev) | Build-time CSS toolchain, dev-only, unmodified. No obligation. |
| `jszip@3.10.1` | **(MIT OR GPL-3.0-or-later)** — dual | `exceljs@4.4.0` ← **runtime dependency** | Dual-licensed: **elect MIT and the GPL arm never applies.** This is a runtime dep (it is what writes the `.xlsx` in `/api/gc/export`), so record the MIT election in your attribution file. No practical risk. |
| `buffers@0.1.1` | **UNKNOWN — no `license` field** | `binary@0.3.0` ← `unzipper@0.10.14` ← `exceljs@4.4.0` ← **runtime dependency** | A 2012-era micro-package with no declared license, reached transitively through the export path. Legally this means *no license granted*, which is technically worse than GPL. In practice it is ~100 lines of buffer concatenation from the substack era and universally treated as MIT, but it is undeclared. **Recommend confirming upstream or noting it as an accepted exception** — it is the only package in 552 with no license at all. |

Everything else is permissive (MIT / Apache-2.0 / ISC / BSD / 0BSD / Unlicense / CC0 / MIT-0 /
BlueOak / Python-2.0 / SIL OFL for a font). **No AGPL, no SSPL, no EPL, no CDDL, no plain GPL
anywhere.** No package requires source disclosure of GC's own code.

## K. AI and LLM surfaces

Every row resolves the same way, and the reason is the same fact, so I state the evidence once in K1
and cite it. **This is not a pass — it is an absence.** All eight rows should be re-run the moment the
first model call is merged.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| K1 | Inventory every Claude API call site | **N/A-NOT-BUILT** | **Zero call sites.** No model SDK in `package.json`; `grep -rin "anthropic\|api\.anthropic\|claude-\|openai\|gpt-\|gemini\|mistral\|cohere\|langchain\|@ai-sdk\|generateText\|streamText"` over `src/` and `supabase/` returns only `supabase/config.toml:100-101` and a commented example at line 153 — Supabase **Studio's local dev container** AI assistant, not application code and not deployed. No `supabase/functions/` directory exists. There is no prompt template in the repo to inventory. |
| K2 | Identify call sites receiving client-supplied text | **N/A-NOT-BUILT** | Nothing consumes client text into a model. For when it does, the client-supplied text that will matter is already identifiable: `title_metadata.data` jsonb (free-text `synopsis` written by the client, `src/lib/metadata.ts`), `titles.title`, and `source_documents.raw` (uploaded sheet contents, once BYO-sheet intake lands). Those three are the untrusted-input surface a future K2 must cover. |
| K3 | Model output never drives a privileged action unreviewed | **N/A-NOT-BUILT** | See the priority section above, incl. the four seams already in place and the one line already doing the right thing (`reconcile_title_findings` scopes its auto-resolve to `source = 'validator'`, `20260720000600_findings.sql:94-96`). |
| K4 | Model output validated before use | **N/A-NOT-BUILT** | No output to validate. The validation pattern the repo will reuse exists and is sound: zod at the edge (9 route handlers) plus `parseExportSpec` (`src/lib/export-spec.ts`) — a zod schema that parses an untrusted vendor spec and returns `{ok:false}` rather than throwing, with `STANDARD_EXPORT_TEMPLATE` as the fallback (`src/app/api/gc/export/route.ts:25-26`). That is exactly the shape CLAUDE.md's "AI maps; the zod validator decides" requires. |
| K5 | Untrusted text delimited from instructions | **N/A-NOT-BUILT** | No prompt exists in the repo — no template file, no system-prompt string, no interpolation to inspect. |
| K6 | No secrets, internal IDs, or other orgs' data in prompt context | **N/A-NOT-BUILT** | No prompt context is assembled anywhere. The rule to hold when one is: CLAUDE.md requires Globee to run with the user's JWT so RLS fails closed. Note that Part 1 B3 proved RLS holds under a user JWT across 110 attempts, so that control is available and verified — the risk will be building Globee on the service-role pattern instead. |
| K7 | Model calls rate-limited and cost-capped per org | **N/A-NOT-BUILT** | No model calls to limit. Cross-referencing Part 1 E1 as instructed: **there is no rate-limiting layer in the repo at all** (`grep -rin "ratelimit\|throttle\|upstash"` → no matches), so when the first AI surface ships it will inherit zero infrastructure. Part 1 I1/I2 (Anthropic Console spend cap and 50% alert) are also unset and currently have nothing to cap. |
| K8 | Prompt/response logging does not retain client content indefinitely | **N/A-NOT-BUILT** | Nothing logs prompts or responses. Relevant existing posture: Part 1 D6 confirmed all 16 `console.error` sites log a route tag plus `error.message` only — no bodies, no headers. The retention question is live for a different table though: `findings.message` will hold AI-authored text about client content permanently, since `findings` has no DELETE policy and no retention job. Worth deciding before AI findings ship, not after. |

## L. Business logic abuse

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| L1 | Referral self-referral blocked | **N/A-NOT-BUILT** | No referral system exists: `grep -rin "referral\|referrer\|accrual"` over `src/` and `supabase/migrations/` → **zero matches**. No column, no table, no attribution field. Neither the self-referral nor the mutual-referral rule is enforced anywhere, because there is nothing to enforce them on. When built: the single-level + frozen-at-signup rule wants a DB constraint, not application logic — cross-reference Part 1 G10. |
| L2 | Referral accrual cannot be triggered, replayed, or backdated | **N/A-NOT-BUILT** | Same — and note there is **no scheduled job infrastructure of any kind**: no `pg_cron` extension, no Vercel cron (`vercel.json`/`vercel.ts` do not exist), no `.github/workflows` schedule. The first cron this product needs is the rule-8 lapse job, which must be idempotent; it is also unbuilt. |
| L3 | Tier change timing cannot dodge fees | **N/A-NOT-BUILT** | `term_trigger_enum` reserves `('signup','upgrade','downgrade','lapse','renewal','reinstate')` (`20260717000100_clickwrap_stripe_contract_terms.sql:59`), but **only `'signup'` is ever written** — by `accept_terms` (line 204) and `finalize_paid_signup` (line 246). There is no upgrade path, no downgrade path, no cancel path, and no code that ever sets `organizations.status = 'payment_lapsed'` (the value exists at line 44 and is rendered as a label at `src/app/(app)/page.tsx:25`, but nothing writes it). With no tier-change path and no fee table, there is no timing to game yet. The seam is correctly shaped: `contract_terms` is effective-dated with a snapshotted rate, so a later tier change appends rather than mutates. |
| L4 | Early Takedown Fee cannot be avoided by deleting/re-creating the title | **N/A-NOT-BUILT**, but the deletion half is already safe | No takedown flow and no fee table (`grep "early_takedown\|rights_change"` over migrations → one comment at `20260718000200_rights_grants.sql:20` describing them as future work). The row's specific worry — "does takedown state survive asset deletion" — is already answered structurally: **assets cannot be deleted.** `assets` has a SELECT policy only, `DELETE` is not granted, and `assets.title_id`/`org_id` are `ON DELETE RESTRICT`. Likewise titles: no DELETE policy anywhere in the schema. So "delete and re-create to escape the fee" has no mechanism. What is missing is the state to attach the fee to — `takedown_requested` and `taken_down` are unreachable enum values (see L7). |
| L5 | Rights change fee applies on every qualifying change | **N/A-NOT-BUILT**, and rights are currently append-only | No fee logic exists. Structurally relevant: **`rights_grants` has no update path at all.** `add_rights_grant` only inserts (one row per rights type), nothing anywhere sets `effective_to` (`grep "effective_to"` across migrations returns only *reads* — the `effective_to is null` active-grant predicate in `can_deliver`, `create_delivery`, and `portal_resolve_download`), and direct `UPDATE` is revoked. So grants can currently only expand, never contract or close — which happens to match golden rule 12, but by absence rather than by design. When the $97 change fee is built, the write path it must pass through does not yet exist, so there is no bypass to close today. |
| L6 | Term commitments enforced server-side | **DONE** | Term length is **computed in SQL from the tier and never accepted from the client**. `finalize_paid_signup` (`20260717000100_…:230`): `v_term_months int := case when p_tier = 'premium' then 24 else 12 end`, and `expires_at` is derived as `p_effective_from + (v_term_months || ' months')::interval` (line 246). `accept_terms` hardcodes 12 months for the free Access tier (line 204). `p_effective_from` is the **Stripe event timestamp**, passed from the verified webhook (`src/app/api/stripe/webhook/route.ts:40`), never `now()` and never client input. `finalize_paid_signup` is `service_role`-only (`20260717000100_…:252-253`) and Part 1 confirmed a client calling it gets `42501 permission denied for function`. The tier itself is read server-side from the accepted agreement source document, not from the request (Part 1 G6). |
| L7 | **Chain-of-title gate cannot be bypassed** | **PARTIAL** | See the priority section. Q1 (status transition) is airtight and exhaustively enumerated; Q2 (is the gate load-bearing) fails on five downstream RPCs, live-proven. |
| L8 | Asset state machine has no illegal transitions | **PARTIAL** | **Assets have no state machine at all** — the `assets` table has no `status` column (columns: `id, org_id, title_id, kind, storage_key, content_hash, bytes, content_type, original_filename, received_at, provided_by, created_at`). An asset simply exists once uploaded; the `20260718000500_assets.sql` header records this as deliberate. So there are no illegal asset transitions because there are no transitions. The two state machines that do exist: **(1) `titles.status`** — three of seven values reachable, transitions constrained by `where` clauses in `submit_title` and `review_title`, and **no status is settable directly by any client role** (RLS SELECT-only; tested live as Q1a). **(2) `deliveries.status`** — `set_delivery_status` (`20260719000600_deliveries.sql:116-127`) accepts **any** `delivery_status` value with **no transition validation whatsoever**: `taken_down → live`, `rejected → live`, or `pending → taken_down` all succeed. GC-only, and status is meant to be person-set with `audit_log` as the provenance record (the migration header says so), so this is defensible by design — but it means a mis-click is silently valid, and `portal_resolve_download`'s fail-closed allowlist (`pending/delivered/live`) can be re-opened on a taken-down title by one call. Not settable by a client role. |
| L9 | Payout figures derive from stored source records | **N/A-NOT-BUILT** | No payout, statement, or accounting-period tables exist; the revenue module is deferred. No monetary figure is computed anywhere in the app. The rule-4 provenance triple that L9 will depend on is implemented exactly once, and correctly: `findings` carries `source_refs` + `logic_version` + `derived_at` (`20260720000600_findings.sql`, columns confirmed live), written by `reconcile_title_findings` on every row. `notifications` carries `source_refs` only. That is the pattern to extend to statements. Today's derived numbers are display-only dashboard counts computed per request from live rows (`src/lib/catalog-activity.ts`, unit-tested) — correct for a count, and not a payout figure. |

## M. Resilience and recoverability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| M1 | Migrations reversible or explicitly marked irreversible | **PARTIAL** | **31 migrations, zero `down`/rollback files** — the scheme is forward-only by policy, stated in migration headers ("Forward-only + idempotent where possible"). The discipline around it is unusually good: **23 of 31 carry an explicit `DESTRUCTIVE OPS` header block** listing what the migration does that cannot be undone, which is the "explicitly marked" half of the row. The genuinely irreversible operations, enumerated: **(a)** `20260717000100_…:41-48` — the `org_status` recreate-and-swap ending in `drop type public.org_status_old`. This one has a real recovery path: lines 31-39 pre-check for rows using a value being dropped and `raise exception` if any exist, so it fails loudly rather than losing data. **(b)** Three `alter type … add value` migrations (`20260720000200:5` `screener`; `20260720000500:7` `restore_requested`; `20260722000100:9-10` `poster`/`banner`) — Postgres **cannot remove an enum value**, so these are irreversible by nature and correctly documented as such. **(c)** `20260720000300:19-20` — `drop not null` on `portal_links.delivery_id`/`asset_id`, reversible only if no null rows have accumulated. **What is missing is a stated recovery path for the data backfills** (see M2), and there is no documented restore-from-backup procedure to fall back on (cross-reference M6/M9 and Part 1 D8). |
| M2 | No migration drops or rewrites a column holding legal or financial evidence | **DONE** | I scanned all 31 migration files for `DROP TYPE/TABLE/COLUMN`, `ALTER TYPE/COLUMN`, and migration-time `UPDATE`/`DELETE` statements, separating statements inside `create or replace function` bodies (runtime RPC logic, not migration-time rewrites) from actual DDL/DML. **No migration touches `contract_assents`, `contract_terms`, `subscriptions`, `source_documents`, `source_records`, `audit_log`, or `rights_grants` in a destructive way.** No column is dropped anywhere in the repo's history. The three real migration-time data rewrites are all non-evidentiary: `20260721000200_release_dates.sql:49-57` (backfills `original_release_date`/`release_date` from `title_metadata.release_year`, regex-guarded to `^\d{4}$`, `coalesce`-guarded to fill NULLs only — additive and safe); `20260722000200_backfill_artwork_to_poster.sql:7` (`update public.assets set kind = 'poster' where kind = 'artwork'`); and `20260721000300_screener_share_token.sql:57-61` (inside the `create_screener_link` body, so runtime not migration). The `artwork → poster` backfill is the only **lossy** one — after it runs, no column records which rows were originally `artwork`, and there is no down migration. Low consequence (asset labelling, not evidence) and the header explains the reasoning, but it is the one rewrite with no recovery path. |
| M3 | Soft-delete rather than hard-delete for rights and payout records | **DONE** | Enforced three ways, and uniformly. **(1) No table in the schema has a DELETE policy** — 26 tables, 34 policies, zero for DELETE (Part 1 B2), so RLS denies deletion to every client role by default. **(2) `revoke … delete` is applied explicitly** on the append-only tables: `audit_log`, `source_documents`, `source_records` (`20260716000100_…:329-331`), `contract_assents` (`20260717000100_…:151`), `deliveries` (`20260719000600:49`), `export_records` (`20260719000700:26`), `works` (`20260719000500:35`), `screener_view_events` (`20260720000300:44-45`), portal tables (`20260720000100:87-99`). **(3) Zero `ON DELETE CASCADE` in the entire schema** (`pg_constraint` where `confdeltype='c'` → empty); every FK is `RESTRICT` or `SET NULL` on `auth.users` back-references. Rights specifically: `rights_grants` has an `effective_to` column for soft-closure and no delete path at all (see L5). Payout: no such table yet. |
| M4 | Referential integrity across asset / rights / org / payout | **PARTIAL** | See the priority section. 50 FKs, no cascades, core chain fully constrained; three gaps — unconstrained denormalized `org_id` (latent), `export_records.title_ids` as an unvalidated `uuid[]` (live-proven accepting a nonexistent title), polymorphic `findings.entity_id`. |
| M5 | Seed or fixture data cannot reach production | **DONE, with one thing to watch** | **No seed file exists.** `supabase/config.toml:66-71` configures `[db.seed] sql_paths = ["./seed.sql"]`, but `supabase/seed.sql` **is not present in the repo** — so `supabase db reset` seeds nothing. That config block is Supabase's default scaffold, not a wired-up path. The 22 pgTAP files in `supabase/tests/` are `begin … rollback`-wrapped and are not referenced by any deploy or CI path (they are not run anywhere — see O4). No fixture data is imported by `next build`. **The thing to watch:** the two audit harnesses I added (`scripts/security/b3-cross-org-isolation.mjs`, `scripts/security/l7-chain-of-title-gate.mjs`) create real orgs, users, titles, and deliveries, and while both default to `http://127.0.0.1:54321`, both accept `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment. Pointed at production with a production service-role key they would write production rows. They are not wired into any build or deploy path, but they are the one seed-shaped thing now in the repo — worth an explicit guard (refuse to run against a non-localhost URL) if you keep them. |
| M6 | Supabase point-in-time recovery enabled, per project | **OUT-OF-REPO** | Supabase dashboard → Database → Backups, for project `uevsculwzwlhxeamagwg` (ref from `.github/workflows/migration-drift.yml:31`) and the other two projects. Nothing in the repo configures or asserts backup policy. Note PITR is a paid add-on and is **off by default** — confirm rather than assume. Given M1 (forward-only migrations, no rollback files), PITR is the actual recovery mechanism for a bad migration, which makes this row load-bearing rather than routine. |
| M7 | S3 versioning and delete protection on media buckets | **PARTIAL** — verified live, not defined as code | No bucket configuration exists as code (no Terraform/CDK/CloudFormation; `docs/infra/*.md` are manual `aws` CLI runbooks). Verified directly against the account instead: **`gc-content-assets-prod` has versioning `Enabled`; `gc-content-assets-dev` has versioning not enabled** (`get-bucket-versioning` returns empty). Both have default `AES256` encryption. **Neither bucket has MFA Delete, an Object Lock configuration, or any lifecycle rule** (`get-bucket-lifecycle-configuration` → `NoSuchLifecycleConfiguration` on prod). So prod media is recoverable from a delete-marker but is not protected against a credentialled delete of all versions, and there is no `NoncurrentVersionExpiration` rule bounding the cost of versioning either. Cross-reference Part 1 Finding 5 (the Glacier lifecycle rule is also absent) — these are the same missing piece of bucket configuration. |
| M8 | Glacier restore path tested, not assumed | **OUT-OF-REPO — and known-untested** | AWS console / a deliberate test restore. The repo evidence is unambiguous that it has never run: Part 1 established there is **no lifecycle rule tiering masters to Glacier**, so no object has ever been in `GLACIER` storage class, so `resolveOrRestore` (`src/lib/s3.ts:113-121`) has never taken its restore branch in production. The pure mapping function `parseRestore` is unit-tested (`src/lib/s3.test.ts`), which covers the header parsing but not the AWS round-trip, the 5-12h wait, or the `restoring` UX. **To do:** tier one non-critical object to Glacier Flexible manually and drive a real portal download through it end to end. |
| M9 | A restore has actually been performed at least once | **OUT-OF-REPO** | Nothing in the repo records a restore drill — no runbook, no log, no dated note. `docs/infra/` contains four provisioning documents (`asset-storage-setup.md`, `asset-portal-setup.md`, `portal-go-live-checklist.md`, `portal-go-live-runbook.md`) and none covers restore or disaster recovery. **Two distinct restores need drilling and neither has been:** the Supabase database (M6) and an S3/Glacier object (M8). As the row says — untested backups are not backups. Given forward-only migrations with no rollback path, the database restore is the one I would rehearse first. |

## O. Making this recur

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| O1 | Secret scanning automatic on commit or in CI | **MISSING** | No secret scanning of any kind. No `.gitleaks.toml`, no `.pre-commit-config.yaml`, no `.husky/`, no `trufflehog`/`gitleaks` reference in `.github/`. GitHub's native push protection is a repo setting and would not show here (**OUT-OF-REPO** — check Settings → Code security). Part 1 D3 established the history is currently clean, which makes this the right moment to add scanning: you are protecting a known-good baseline rather than triaging a backlog. Concrete config proposed below — **not installed**. |
| O2 | `npm audit` in CI, failing on high severity | **MISSING** | No workflow runs `pnpm audit`. The only workflow triggers on `supabase/migrations/**` and runs the Supabase CLI. This is why Part 1 H2 found **8 high advisories** sitting unnoticed — including the Next.js middleware-bypass advisory against a middleware-authenticated app. A gate here converts that from a discovery into a blocked PR. |
| O3 | Typecheck and lint gate merges | **MISSING** | Nothing runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, or `pnpm build` in CI. All four exist as scripts and all four currently pass (Part 1 H3: typecheck clean under `strict`, 82 tests green) — they are simply not enforced. Combined with J8 (no CODEOWNERS, and the one workflow is path-filtered to migrations only), **a PR touching only `src/` runs zero automated checks**, and nothing in the repo requires a review either. |
| O4 | Cross-org isolation test exists as a repeatable test, not a one-off script | **PARTIAL** | Two artefacts exist and **neither is executed by anything**. (1) `supabase/tests/rls_tenant_isolation_test.sql` — a proper pgTAP test that correctly drops to `set local role authenticated` and asserts 10 isolation properties; one of 22 pgTAP files, none of which is run by any workflow, script, or `package.json` entry. (2) `scripts/security/b3-cross-org-isolation.mjs` from Part 1 — repeatable and self-verifying (134 attempts, exits non-zero on failure), but invoked by hand and not referenced in `package.json` or CI. The matrix is right that this is the row most worth automating: it is the only check that would catch a policy regression on a table added six months from now. Making it recur needs two small things — a `package.json` script, and a workflow that stands up Supabase and runs both the pgTAP suite and the harness. |
| O5 | Claude Security plugin scan recorded per release, results retained | **MISSING** | The plugin has never been run here (Part 1 H1: not installed in that session either). No results directory exists, and `.gitignore` has **no entry** for one — so the current state is undefined rather than deliberate: a future scan would drop a timestamped directory straight into the working tree as untracked files, to be committed by accident or lost. Decide before the first run: commit them (an auditable per-release trail, but the findings text lands in git history) or ignore them and archive elsewhere. |
| O6 | Both matrices referenced in the repo's CLAUDE.md as a pre-launch gate | **MISSING** | `grep -rn "security-coverage-matrix\|security-audit-findings\|claude-security\|pre-launch gate" CLAUDE.md docs/ .gitignore` → **no matches anywhere.** (Note: the matrix says `dashboard-CLAUDE.md`; in this repo the file is `CLAUDE.md` at the root.) The only security-process instruction currently in CLAUDE.md is line 206, *"Secrets server-only. Run `leak-check` before shipping"* — one line covering one Part 1 row (D1). Neither matrix, neither findings file, and no re-run trigger is recorded, so the next launch does start from memory. This is the cheapest row in either matrix to close and the one that makes the other 76 durable. |

### Proposed configs for O1-O4 (not installed, per instruction)

A single workflow closes O2, O3, and half of O4, and would have caught Part 1's H2 finding:

```yaml
# .github/workflows/ci.yml — proposed, NOT added
name: ci
on: { pull_request: {}, push: { branches: [main] } }
permissions: { contents: read }
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile   # also enforces J1 on every PR
      - run: pnpm typecheck                   # O3
      - run: pnpm lint                        # O3
      - run: pnpm test                        # O3
      - run: pnpm audit --audit-level high    # O2 — fails the build on high
  isolation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start && supabase test db          # O4 — the 22 pgTAP files
      - run: node scripts/security/b3-cross-org-isolation.mjs   # O4 — exits 1 on breach
      - run: node scripts/security/l7-chain-of-title-gate.mjs   # L7 regression guard
```

For O1, gitleaks as a pre-commit hook plus a CI job (`gitleaks/gitleaks-action@v2`), scanning full
history on a schedule and the diff on PRs. For O6, a short "Pre-launch gate" section in `CLAUDE.md`
pointing at both matrices and both findings files, with the instruction to re-run before each launch
(matrix row H4).

---

# Section N — Owner checklist

Not code-auditable. These are actions for you, not findings. I have added what the repo reveals where
it reveals anything — several of these have concrete starting points already sitting in the codebase.

| # | Item | ☐ | What the repo shows |
|---|---|---|---|
| N1 | MFA on AWS root, AWS IAM users, Supabase, Vercel, GitHub, Stripe, Trolley, Cloudflare, Anthropic Console | ☐ | Nothing in-repo. Two notes: **Trolley and Anthropic have no account yet** (no integration code exists), so those are future items. And Part 1 C10 found **no MFA in the product itself** — `gc_staff` is single-factor email possession, and `member_can` returns true for *every org* when `is_gc_staff` (`20260716000100_…:170`). Provider-level MFA on the GC staff mailbox is currently the only factor protecting all-tenant access. |
| N2 | AWS root credentials offline and unused for daily work | ☐ | Repo shows AWS account **`469511672937`** (from the prod bucket policy) and a named CLI profile `gc`, which suggests day-to-day work already runs through a non-root profile. Confirm the profile maps to an IAM principal, not root, and check whether it is scoped or `AdministratorAccess`. |
| N3 | Inventory of who holds production access to each service | ☐ | No inventory exists (this is Part 1 A3's data inventory viewed from the access side — both are missing). Services in play, from the repo: Supabase (prod project `uevsculwzwlhxeamagwg`), Vercel (team E8 Holdings), AWS `469511672937`, Stripe, Resend, Cloudflare Turnstile, GitHub. |
| N4 | Offboarding procedure for `gc_staff` — which credentials, in what order | ☐ | The **application** side is a single, clean revocation: delete the row in `gc_staff`, and `is_gc_staff()` immediately returns false everywhere, because every policy resolves through it per statement. Part 1 C8 proved this class of change takes effect on the next query with no token refresh. What has no procedure is everything around it: the Supabase dashboard seat, Vercel, AWS, GitHub, the shared mailbox, and — per CLAUDE.md — **vendor portal credentials, which live in a password manager and not in the database**, so no code path revokes them. That password manager is the offboarding gap. |
| N5 | Key rotation runbook | ☐ | **Missing** (Part 1 D8). Eight secrets in play. The two that will hurt: the **CloudFront key pair** (`CLOUDFRONT_KEY_PAIR_ID` + `CLOUDFRONT_PRIVATE_KEY`) — rotating without a two-key overlap in trusted key group `fe99aa8a-786a-428a-9222-4cb4d9ca3094` will 403 every signed URL in flight, including a vendor mid-download; and the **Supabase service-role key**, which the six portal routes and the Stripe webhook all depend on. |
| N6 | Incident response plan: who is notified, who decides, who communicates | ☐ | Nothing in-repo. One relevant capability: `audit_log` is trigger-populated, append-only, and carries `before`/`after` for every business-table change (`20260716000100_…:193-237`), so post-incident reconstruction is genuinely possible — which is more than most products this age have. Also note CLAUDE.md's two-channel rule constrains *who* may communicate: Global Content Support pushes bad news, Globee never initiates. A breach notice is a `gc_support` communication and a founder checkpoint. |
| N7 | Breach notification obligations — Texas statute, GDPR 72-hour clock if any EU data subjects | ☐ | The repo makes EU exposure likely rather than hypothetical: `src/lib/territories.ts` enumerates the **full ISO 3166-1 set** for rights territories, and prod S3 CORS allows `https://app.globalcontent.co` with no geographic restriction on the CloudFront distribution (`Restrictions: none`, verified live). Rights holders are businesses, but their named contacts are personal data. Also: Part 1 A1 found **no privacy policy in this repo** and A3 found **no data inventory** — you cannot run a 72-hour clock without knowing where the data is. |
| N8 | DPAs with every processor | ☐ | Processors actually receiving data today, from the code: **Supabase** (all PII), **Vercel** (hosting/logs), **AWS** (masters, screeners, artwork — the highest-consequence one), **Stripe** (`src/lib/stripe/server.ts`), **Resend** (`src/lib/email.ts:10` — recipient email addresses and OTP codes), **Cloudflare** (Turnstile, `src/lib/turnstile.ts:17`). **Not yet processors:** Trolley, GoHighLevel, and the QC vendor — no integration code exists for any of them, so those DPAs are needed before the integration, not now. |
| N9 | Subprocessor list published, consistent with the privacy policy | ☐ | Blocked on N8 and on Part 1 A1/A2 — there is no privacy policy in this repo to be consistent with, and the clickwrap text is still `"2026-07-placeholder"` (`src/lib/agreements.ts:9`). Sequence: data inventory → DPAs → subprocessor list → privacy policy → clickwrap referencing it. |
| N10 | QC vendor contractually bound to confidentiality and security terms | ☐ | No QC vendor is integrated (Part 2 confirms no Quasar/Baton code; the matrix's own Open Items note the schema is undefined). This is a pre-integration contract item. When it lands, the master-access path it will need is the same one `portal_resolve_download` guards today — worth binding the vendor to terms that match that gate's assumptions. |
| N11 | Security terms in rights-holder agreements match what the platform actually does | ☐ | **Currently unmeetable, and worth flagging as sequencing rather than an oversight**: the agreement is placeholder text (`src/lib/agreements.ts:4-6`), so there is nothing to compare the platform against. When counsel drafts it, the platform facts that belong in it and are verified: media is private-bucket + OAC + CloudFront signed URLs with a trusted key group (Part 1 F1-F3, verified live); master access is OTP-gated and re-checks the rights grant at request time (F6); every access is recorded in `portal_access_events` and the download fails closed if that record cannot be written (`src/app/api/portal/download/route.ts:54-60`). Do not let the agreement promise encryption-at-rest guarantees beyond `AES256` SSE-S3, or a QC posture you have not contracted for. |
| N12 | TPN posture — Blue Shield self-attestation, Gold Shield if a partner requires it | ☐ | Repo-relevant input for the questionnaire: manual delivery by staff, no transcoding, masters in S3 with OAC-only access, OTP + signed-URL distribution, append-only access log. Two gaps a TPN assessor will ask about that Part 1/2 already found: **no MFA on staff accounts** (C10) and **no documented key rotation or incident response** (D8, N5, N6). CLAUDE.md is explicit that vendor/partner names are unconfirmed — confirm shield requirements directly with each partner, contract by contract. |
| N13 | MPA Content Security Best Practices reviewed against the actual workflow | ☐ | The asset-handling workflow to review against is fully documented in code: upload (presigned multipart direct to S3, org-prefixed keys), storage (private bucket, versioned on prod, AES256), internal access (`/api/gc/asset-url`, `gc_staff` only), external access (OTP + session + grant re-check + short-TTL signed URL), and audit (`portal_access_events`, `screener_view_events`). Known deltas to disclose in any assessment: no MFA for staff; no Glacier lifecycle despite the policy stating one (Part 1 Finding 5); no watermarking or DRM on screeners — `PORTAL_COPY.screenerNotice` is a text notice only (`src/lib/portal.ts:65`) and the stream TTL is 6 hours. |
| N14 | Manual delivery reviewed as a security surface, not just an ops task | ☐ | **The single most under-controlled surface in the product, and the repo says so implicitly.** Delivery is a human exporting an `.xlsx` (`/api/gc/export`) and uploading it to a vendor's portal using credentials held in a password manager, outside the database. Three specifics: (1) **L7 above** — nothing server-side requires a title to have passed chain-of-title review before it can be exported or delivered; the only check is a UI dropdown. (2) The exported `.xlsx` lands on a staff laptop with no classification, no expiry, and no record of where it went after `export_records` (cross-reference N15). (3) The vendor-email leg is **not built** — `vendors.email_to`/`email_template` are stored but nothing sends them, so today's delivery email is a human writing from their own mailbox, entirely unlogged. |
| N15 | Developer endpoint security: disk encryption, screen lock, no prod credentials in shell history or plaintext notes | ☐ | Repo-visible hints that this is live right now: a `.env.local` exists at the repo root (correctly gitignored, `.gitignore:3-5`) and holds real AWS, Stripe, Supabase service-role, CloudFront private-key, and Resend values; the `gc` AWS CLI profile is configured with working credentials on this machine (I used it read-only for F1/F2/M7); and `vod_titles.csv` / `vod_titles.json` sit untracked at the repo root — **real client catalog data**, gitignored deliberately (`.gitignore:16-22`) with a comment calling it Tier-3 data. That file is exactly the "plaintext note" category. Also check shell history for `psql` connection strings and `supabase link` invocations. |
| N16 | External pen test or security review before onboarding rights holders at scale | ☐ | Not scheduled (nothing in-repo). Sequencing suggestion from what these two audits found: fix the dependency backlog (Part 1 H2 — 8 high, including a middleware bypass in a middleware-authenticated app), add security headers (E6 — currently none), and close L7's server-side interlock **before** paying for a test, so the tester spends their time on things a matrix cannot find. The two isolation harnesses in `scripts/security/` are worth handing over as a starting point — they document the tenancy model faster than the schema does. |

---

# Findings, worst first

## 1. The chain-of-title review gate is not enforced server-side downstream (L7)

Five RPCs deliver a title without ever reading `titles.status`: `create_delivery`,
`set_delivery_status`, `create_portal_link`, `create_screener_link`, `record_export`. Live-proven —
a title that was never submitted and never reviewed was given a delivery record, marked `live`, and
had a master-download link minted for it. The only thing standing between a `draft` title and a
vendor is a UI dropdown filter at `src/app/(app)/(operator)/gc/deliveries/page.tsx:29-31`.

Requires a `gc_staff` account, so it is an operator-error and defence-in-depth problem rather than a
client-facing hole. But this is the one human gate in a self-serve model, and `create_delivery`
already demonstrates the correct pattern three lines away — it re-validates the rights grant at
`20260719000600_deliveries.sql:78-90` rather than trusting the caller. The status check is the same
shape and is simply absent. The fix is a status predicate in the RPCs, which is a migration and
therefore your call.

## 2. `export_records` accepts title ids that do not exist (M4)

`record_export(p_vendor_id, p_title_ids uuid[], p_payload)` validates nothing beyond `is_gc_staff`
(`20260719000700_export_and_submit_gate.sql:31-42`). Proven live: a call with a random UUID was
accepted and wrote a row referencing a nonexistent title. Postgres cannot FK an array, so this needs
either an explicit existence check in the RPC or a join table. It matters because `export_records`
is a **provenance table** — the immutable record of what GC represented to a distribution endpoint.
A provenance row whose subject cannot be resolved is not evidence.

## 3. Two intended `revoke`s on `can_deliver` never took effect (newly surfaced)

`can_deliver` is the rule-12 delivery gate. Migration `20260718000200_rights_grants.sql:193` revokes
EXECUTE `from anon`, and `20260718000400_rights_grant_hardening.sql:84` revokes it `from
authenticated`, with a comment claiming "Least privilege: no client caller for can_deliver yet".
**Both are ineffective.** The live ACL is:

```
can_deliver | =X/postgres , postgres=X/postgres , service_role=X/postgres
```

The leading `=X` is **PUBLIC**, and neither revoke targeted `public` — so PostgreSQL's default
`GRANT EXECUTE … TO PUBLIC` survives, and both `anon` and `authenticated` can still call it
(`has_function_privilege('anon', …, 'EXECUTE')` → `true`). Contrast `create_title`, whose migration
revokes `from public, anon` and whose ACL correctly has no `=X` entry.

Impact is small but real: `can_deliver(title_id, rights_type, territory, at) → boolean` is
`SECURITY DEFINER` with no tenant check, so an **unauthenticated** caller who knows a title UUID can
enumerate that title's rights coverage across all 21 rights types and every territory. Title UUIDs
are v4 and not exposed publicly, so this is an oracle requiring prior knowledge rather than an open
leak. The more important point is that **the schema does not have the least privilege its own
migration asserts** — and the same `from anon` (without `public`) idiom would silently fail anywhere
else it is used. `member_can` and `is_gc_staff` are also PUBLIC-executable, though by design and
with weaker oracles.

## 4. `buffers@0.1.1` ships in the runtime dependency tree with no declared license (J3)

Reached via `exceljs → unzipper → binary → buffers`, so it is in the production bundle path for the
vendor export. No `license` field at all, which strictly means no grant of rights. It is a trivial
2012 substack-era micro-package universally treated as MIT, and the realistic risk is close to zero
— but it is the only package in 552 with nothing declared, and "we assumed" is a weak answer to a
rights holder's counsel. Either confirm upstream, or record it as a documented accepted exception.

Separately, `@img/sharp-libvips` is **LGPL-3.0-or-later** in the runtime tree via Next.js image
optimization. Compliant as used (unmodified, dynamically linked), but it carries an attribution and
source-availability obligation that should be written into an attribution file rather than
discovered later.

## 5. Nothing makes any of this recur (O1-O6)

No CI runs typecheck, lint, tests, `pnpm audit`, or either isolation harness. The one workflow is
path-filtered to `supabase/migrations/**` and explicitly designed not to gate, so **a PR touching
only `src/` runs no automated check at all** — and with no CODEOWNERS (J8), nothing requires a human
review either. Both matrices are unreferenced in `CLAUDE.md`. Every finding in Part 1 and Part 2 is
therefore a snapshot that starts decaying the moment it is written. The proposed `ci.yml` above
closes O2, O3, and O4 in one file and would have caught Part 1's 8 high advisories before they
accumulated.

---

## Summary of statuses

Sections J, K, L, M, O — **40 rows** (J 8, K 8, L 9, M 9, O 6). Section N is a 16-item owner
checklist, not statuses.

| Status | Count | Rows |
|---|---|---|
| **DONE** | 10 | J1, J2, J3, J4, J5, J7, L6, M2, M3, M5 |
| **PARTIAL** | 7 | J6, L7, L8, M1, M4, M7, O4 |
| **MISSING** | 6 | J8 *(in-repo; GitHub branch protection is OUT-OF-REPO)*, O1, O2, O3, O5, O6 |
| **N/A-NOT-BUILT** | 14 | K1-K8, L1, L2, L3, L4, L5, L9 |
| **OUT-OF-REPO** | 3 | M6, M8, M9 |

Per section: **J** 6 DONE / 1 PARTIAL / 1 MISSING · **K** 8 N/A-NOT-BUILT · **L** 1 DONE / 2 PARTIAL
/ 6 N/A-NOT-BUILT · **M** 3 DONE / 3 PARTIAL / 3 OUT-OF-REPO · **O** 1 PARTIAL / 5 MISSING.

Note the shape of the N/A block: **14 of 40 rows are deferred features**, not passes. Sections K
(AI) and most of L (referral, fees, tier changes, payouts) describe a product that does not exist
yet. Re-run both sections when those ship — K3 and L1-L5 in particular are written against
mechanisms whose absence is the only reason they are currently clean.

**The good news, and it is substantial.** Supply chain is genuinely clean: 646 integrity-pinned
registry resolutions, no git or tarball sources, no vendored code, no install scripts outside a
two-package allowlist, and a lockfile that matches `package.json` entry for entry. Deletion
semantics are uniformly protective — zero cascades in 50 foreign keys, no DELETE policy on any
table, and explicit `revoke delete` on every append-only table. Term commitments are computed in SQL
from Stripe event data and cannot be influenced by a client. No migration has ever dropped a column
or touched a legal or financial evidence table.

**What needs attention, in order.** L7's missing server-side interlock is the one with the worst
consequence-if-wrong in this half of the audit, and it is a small migration. M4's `export_records`
gap undermines a provenance table you will want to rely on. Finding 3 is a reminder to grep for the
`revoke … from anon` idiom without `public` elsewhere. And Section O is the row group that decides
whether Parts 1 and 2 were an event or a practice — right now a `src/`-only PR passes through with
no check and no reviewer.

**Where I could not be exhaustive, as instructed to say:** L7's enumeration is complete for
in-database status writers (derived from `pg_proc`, `pg_trigger`, and the policy/grant state, not
from grep) and for in-repo call sites — but **delivery itself happens outside the system**, by a
person uploading to a vendor portal, and no code audit can enumerate that. That is a property of the
manual-delivery model, and it is why N14 belongs on the owner checklist.

## Reproducing

```bash
# L7 — needs a running local Supabase (`npx supabase status`)
node scripts/security/l7-chain-of-title-gate.mjs     # exit 1 = at least one UNGATED path

# L7 Q1 enumeration — every function that writes titles, and which touch status
psql "$DB" -c "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?titles';"

# M4 — foreign keys, and the cascade check
psql "$DB" -c "select rel.relname, pg_get_constraintdef(con.oid) from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace
  where n.nspname='public' and con.contype='f' order by 1;"
psql "$DB" -c "select count(*) from pg_constraint where contype='f' and confdeltype='c';"  # expect 0

# Finding 3 — the ineffective revoke
psql "$DB" -c "select proname, proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname in ('can_deliver','create_title');"  # '=X/postgres' == PUBLIC

# J3 — license inventory
# walks node_modules/.pnpm/*/node_modules/*/package.json; see the inventory section above
```

Both harnesses leave their fixtures in the local database, tagged with a per-run id. The L7 script
creates `l7-<runtag>-{owner,gc}@example.test` and a vendor named `L7-Vendor-<runtag>`.
