# SDD ledger — plan: docs/superpowers/plans/2026-08-06-buyer-title-page.md

Branch: feat/buyer-title-page (from d7450d1 on feat/master-archival-tiering)
Pre-flight: Tasks 1-3 are pure TS and run now. Task 4 writes SQL and STOPS for
founder approval (a PreToolUse hook blocks the migration-apply command; the
founder runs it). Tasks 5-10 cannot typecheck until 20260806000100 and
20260806000200 are applied and `supabase gen types` is re-run.

Task 1: implemented (commit 74b27c3) — spec OK, quality approved with 1 Important
Task 1: fix round 1/5 dispatched — tautological blank-warning test (plan-mandated
  wording; fix realizes the brief's intent rather than contradicting it)
Task 1: fix round 1/5 (0 addressed, 1 open — replacement test still misses the
  gate-widening mutation; fixture title was non-blank; commits 74b27c3..d49a997)
Task 1: fix round 2/5 dispatched — require a BLANK title fixture, verified by
  mutation rather than by argument
Task 1: fix round 2/5 (1 addressed, 0 open; commits d49a997..4a1249c)
Task 1: complete (commits d7450d1..4a1249c, review clean — mutation-verified)
Task 2: complete (commits 4a1249c..e3fa421, review clean)
Task 2: minor (deferred): non-ASCII names are stripped, not transliterated —
  "Societe Generale" style input yields "soci-t-g-n-rale". Safe, but ugly for a
  business distributing international titles. Cosmetic; out of brief scope.
Task 3: complete (commits e3fa421..0e5ffa3, review clean)
Task 3: minor (deferred): test 1 ("is a valid spec") is a tautology — would not
  catch BUYER_EXPORT_TEMPLATE being a copy of STANDARD. Tests 2 and 3 do catch it.
  Inherited from the brief's prescribed test list.
Task 4: implemented (commit 1c99639) — spec OK, quality NOT approved (1 Important)
Task 4: fix round 1/5 dispatched — stale pgTAP assertion at screener_test.sql:312
  (PRE-EXISTING from 1cc7005: the policy widening broke it and pgTAP never ran
  because the migration was never applied); + same-recipient revoke untested;
  + case-insensitive recipient matching before Task 5 exposes a free-text field
Task 4: minor (deferred): purpose_shape CHECK not extended for the new columns
  (unreachable today — direct INSERT is revoked from authenticated)
Task 4: minor (deferred): side classification via is_gc_staff(created_by) is
  evaluated live, not snapshotted — if a link's author later joins gc_staff, the
  client can no longer withdraw that link through the UI (GC still can)
Task 4: fix round 1/5 (3 addressed, 0 open; commits 1c99639..2413460) — but the
  re-review surfaced 2 MORE stale assertions of the same class in the same file
Task 4: fix round 2/5 dispatched — screener_test.sql:115-118 will FAIL on apply
  (counts 2, sees 1, because the widened policy hides GC-authored rows from the
  client identity); :112-114 passes VACUOUSLY (is(NULL,null)) and so never proves
  the author-partitioned revoke, which is the migration's central safety claim
Task 4: note: IS NOT DISTINCT FROM is not index-scannable in Postgres, so the new
  composite index buys nothing over portal_links_title_idx for the revoke. Kept
  for expression-match hygiene; header comment overstates its value.
MIGRATIONS APPLIED by founder. pgTAP: 25 files / 381 assertions PASS.
Types regenerated (commit follows) — hand-edited asset_kind matched exactly;
p_recipient_name is optional as intended. Tasks 5-10 now unblocked.
Task 5: implemented (commit a2636b9) — review deferred; founder added a
  requirement mid-task
Task 5: SCOPE ADDITION (founder, 2026-08-06): typing an existing buyer name must
  WARN, not silently replace. The RPC is revoke-then-create, so a collision kills
  a URL already emailed to that buyer with no signal. Enforced in the server
  action (not UI-only), case-insensitive with ilike wildcard escaping, plus a
  pure helper with Vitest coverage. "Replace link" passes an explicit flag.
Task 5: reviewed (commits 5879e62..44b1431) — spec OK incl. the founder addition,
  ilike escaping verified correct (escapes \ before % and _). 2 Important open.
Task 5: fix round 1/5 dispatched — (a) collision check lacks the RPC's author-side
  partition, so a GC caller would be blocked by a collision the RPC would not
  cause (latent until view-as-client ships); (b) the server-action branching the
  founder required has zero test coverage — only the pure helpers are tested.
Task 5: minor (deferred): residual race — two tabs can both pass the SELECT check
  before either insert commits; the second call's revoke then silently kills the
  first link. Narrows the silent-kill window rather than closing it.
Task 5: fix round 1/5 (2 addressed + 2 minors; commits 44b1431..a4f0a58)
Task 5: complete (commits 5879e62..a4f0a58, review clean)
FOUNDER DECISION 2026-08-06: UNIFY. One link per (title, recipient), whoever
  created it. The author partition was vestigial — it solved a per-title collision
  that the recipient key already solves. Founder noted it should have been asked
  before being invented. Task 5b supersedes parts of Task 4 and Task 5.
Task 5b: implemented (commit 5e14e2a) — unification reviewed: master_download
  still GC-only on read+revoke, cross-tenant intact, no intra-org escalation,
  partition fully removed, plan(53) independently verified. NOT approved: 1 Critical.
Task 5b: fix round 1/5 dispatched — CRITICAL: GC links have NULL recipient_name,
  so the newly-visible row renders as "Unnamed buyer" and Replace silently fails
  to revoke (RPC cannot match NULL) while the UI claims the old URL is dead.
  Plus: no test for the headline new grant (client revokes GC's screener link),
  no cross-org negative test for the widened policy branch.
Task 5b: FOUNDER DECISION NEEDED — revoke_portal_link has no status gate while
  create does. A client account_owner can revoke GC's chain-of-title REVIEW
  screener while the title is in_review, via the RPC (not reachable in the UI).
  Self-defeating rather than a leak — GC can re-mint — so left ungated for now.
Task 5b: fix round 1/5 (4 addressed, 0 open; commits 5e14e2a..b1893fa) plan(57)
Task 5b: complete (commits a4f0a58..b1893fa, review clean)
PENDING FOUNDER: migration 20260806000300_unify_screener_links.sql NOT applied.
  Tasks 6-10 do not depend on it (the portal uses the admin client, so RLS is
  bypassed there), so execution continues.
Task 6: complete (commits b1893fa..fe51d79, review clean)
Task 6: minor (deferred): test 5 (metadata always true) is not load-bearing —
  passes against any implementation. No explicit titleStatus:null test; the
  fail-closed behaviour was confirmed by reading isPostApprovalTitleStatus.
Task 7: complete (commits fe51d79..b9a94ef, review clean) — admin-client page, so
  no RLS backstop; every new query independently confirmed keyed to link.title_id
Task 7: minor (deferred): org_id selected on the title row but never read
Task 7: minor (deferred): "latest asset per kind" tie-break now duplicated
  between artwork.ts and the portal page; justified, but could drift
Task 8: implemented (commit c3a7f09) — spec FAILED, 1 Critical
Task 8: fix round 1/5 dispatched — CRITICAL: name/company marked "(optional)" in
  the UI but request-otp's zod schema still requires them, so leaving them blank
  400s and the buyer is told their link expired. Classic UI-only-rule failure.
  + trailer signed with artwork TTL (1h) when a <video> needs playback-length TTL
  + genre shown as label in the hero and as a raw slug in the grid
Task 8: PLAN DEFECT (mine): Task 9 never specified a master-download route, but
  the spec requires the master post-licence. Folding it into Task 9.
Task 8: FOUNDER CHECKPOINT: new user-visible copy "Prepared for {recipient}" was
  added to an external surface without sign-off. Reads well; needs a yes/no.
Task 8: fix round 1/5 (commit ea8325a) then fix round 2/5 = FOUNDER REVERSAL
  (commit 19ce291): name/company/email all REQUIRED again — portal_sessions has
  all three NOT NULL, so "optional" was fighting the schema and my round-1
  instruction was wrong. "Prepared for" now renders the BUYER's own typed company
  rather than the link's recipient_name (a client's internal label like
  "tubi - dave" must never reach the buyer). All 5 re-review items ADDRESSED.
Task 8: complete (commits b9a94ef..19ce291, review clean)
Task 8: minor (deferred): request-otp's zod schema is back to being inlined and
  therefore untested — a future accidental .optional() would not be caught by
  pnpm test. Pre-existing baseline gap, restored rather than introduced.
Task 9: implemented (commit a25c8ae) — 3 routes + isMasterLicensed. NOT approved.
Task 9: CRITICAL — screener-download serves THE MASTER. screener_source defaults
  to 'master', so "download the screener" signs the master's own storage_key,
  gated only on title-approved. The licence gate on master-download is bypassed
  by the button beside it. Interim fix: refuse screener DOWNLOAD unless the
  source is 'dedicated'; streaming unchanged. Resolves naturally once the
  screener-proxy (option B) lands. FOUNDER INFORMED.
Task 9: fix round 1/5 dispatched — + isMasterLicensed excludes 'pending' where
  the SQL allows it (would refuse licensed buyers at the moment of handover);
  page and route compute `licensed` differently; export filename leaks the
  client's internal label to the buyer; no route has any test.
Task 9: FOLLOW-UP (not this round): rule-12 authorization is now duplicated in
  TypeScript (master-licence.ts) rather than SQL. CLAUDE.md puts authz in the DB.
  Right answer is a portal_resolve_buyer_master SECURITY DEFINER RPC. The two
  copies have ALREADY drifted once (the status list). Needs a migration.
UNIFICATION APPLIED by founder (20260806000300). pgTAP: 25 files / 385 assertions
  PASS (screener_test now 57). One link per (title, recipient) is live in the DB:
  the author partition is gone, clients see and can revoke GC's screener links.
Task 9: fix round 1/5 (8 addressed; commits a25c8ae..2f90d37) — screener-download
  gate verified hard: server-side, DB-read, dedicated titles cannot resolve to
  the master, streaming untouched, new required field cannot fail open.
Task 9: fix round 2/5 dispatched — IMPORTANT: the new cross-vendor test passes
  whether or not the route scopes by vendor (absent filter -> undefined -> still
  no match), i.e. the same test-theatre the previous round deleted, reintroduced.
  + every non-409 failure tells the buyer their link expired, which is false
  + no explanation shown when the screener download is unavailable
  + two reads lost their list bounds; page/route still differ on asset existence
Task 9: FOLLOW-UP (needs a migration, not this branch): TOCTOU between
  portal_resolve_screener resolving the key and the route re-reading
  screener_source. Close it by having the RPC return the resolved asset's kind.
Task 9: fix round 2/5 (5 addressed; commits 2f90d37..3ca7610). Mutation check was
  REAL: deleting .eq("vendor_id") served the other vendor's master (200 not 403).
  Note: the round-1 test would have stayed green even after the fix, because a
  licence bypass and a correct refusal both returned 403 — masked by the separate
  no-master-asset gate. Worth watching for the same masking elsewhere.
Task 9: complete (commits 7607b65..3ca7610, review clean)
Task 9: minor (deferred): a revoked/expired link now surfaces the route's literal
  "Not authorized" instead of the honest expiry copy with "contact your Global
  Content representative". Not false, but less specific and off-voice.
Task 10: implemented (commit bc785fb) — spec FAILED, 2 Critical.
Task 10: CRITICAL A — added a table-wide tg_audit to portal_links, which copies
  whole rows into audit_log. Those rows carry share_token: the RAW un-hashed
  portal URL token. audit_log has UPDATE/DELETE revoked, so it can never be
  removed, and org_id lands NULL so no org-scoped purge reaches it. This repo
  ALREADY refused exactly this in 20260726000800 for portal_sessions — and that
  case was only a SHA-256 hash. Fix: drop the table-wide trigger; have the RPC
  write one explicit REDACTED audit row with org_id resolved from titles.
Task 10: CRITICAL B — the 20 new pgTAP assertions HAVE NEVER RUN. Line 606 orders
  audit_log by created_at; the column is `at`. 42703 aborts the transaction at
  assertion 71/77, so the last 7 never execute and the file fails. The report
  "verified" by grep-counting assertions, which is not running them.
Task 10: + first-attach (the transition that RELEASES the master) has no confirm
  while reassignment does; no detach path exists; unrequested scope.
Task 10: fix round 1/5 (2 Critical + 2 Important + minors addressed; bc785fb..fc5b8a0)
  Audit redesign verified: no trigger, jsonb carries vendor ids only, org_id
  resolved from titles, no-op skipped, insert permitted, append-only intact.
  plan(98) independently confirmed.
Task 10: fix round 2/5 dispatched — the reassignment audit assertions are
  NON-DETERMINISTIC: every audit row in a pgTAP file shares `at` (one txn,
  transaction_timestamp), two rows match, and `order by at desc limit 1` keeps
  the wrong one. Correcting created_at -> at deleted the disambiguating
  predicate. Same class as the defect it was fixing.
  + title_vendor_licensed granted to authenticated with no tenant check =
  cross-tenant oracle; repo already revoked can_deliver for exactly this.
Task 10: fix round 2/5 (2 addressed; fc5b8a0..ec16fd2). Independent per-site audit
  of all 9 order-by-at sites: all now uniquely selected, none by coincidence.
  plan(98) confirmed. title_vendor_licensed revoked from public/anon/authenticated.
Task 10: complete (commits 3ca7610..ec16fd2, review clean)
Task 10: minor (deferred): screener_test.sql:681 — the "after" assertion pins the
  same field its WHERE clause filters on, so it degenerates to an existence check.
  Disambiguate on a value the assertion does not itself assert.
ALL 10 TASKS + 5b COMPLETE. Remaining: apply 20260806000400, end-to-end run,
  whole-branch review.

=== END-TO-END RUN (real dev server + real local DB), 2026-08-06 ===
Fixture: .superpowers/sdd/.../e2e-seed.sql (inserts only, fixed e2e00000-* UUIDs).
Verified by execution, not by reading:
  401 no session cookie
  403 master-download, no vendor attached
  403 screener-download on a master-source title (the Critical from Task 9)
  200 metadata-export -> real xlsx, TITLE COLUMN POPULATED (the Task 1 defect),
      no Offer column, filename GC-0012194_the-long-quiet_2026-08-06_global_content
  attach_link_vendor: REFUSED without force on an already-licensed vendor (the
      Task 10 Important), succeeded with force, audit row has org_id resolved and
      NO share_token / NO token_hash (the Task 10 Critical)
  after attach: master-download 403 -> 500 (gate OPENED; fails at S3 HeadObject
      because the fixture key has no real object) — proves the licence transition
  after attach: metadata filename -> ..._e2e-streaming-co.xlsx (vendor canonical
      name, not the client's internal label — the Task 9 fix)
  server-computed flags match the HTTP responses exactly:
      canWatchScreener true / canDownloadScreener false / canDownloadMaster true

NEW FINDING (missed by 4 reviews, caught only by running it):
  page.tsx still selects recipient_name into the `ready` payload, so the CLIENT'S
  INTERNAL LABEL is shipped in the RSC payload to the buyer's browser. Not
  rendered — but visible in devtools. Task 8's rule was that it must never reach
  the buyer. Reviews checked "is it rendered" and stopped there.
NOT verified (needs real S3 objects): the successful master/screener byte-serve
  path, artwork rendering, and the OTP round-trip (deliberately not exercised —
  request-otp sends through Resend for real).
FINAL WHOLE-BRANCH REVIEW (opus): verdict NOT SAFE TO MERGE — 1 Critical.
Fix wave applied (commit 6dc4f8c, 213 tests): recipient_name + org_id stripped
  from the RSC payload; taken_down gated at point of action in screenerKindFor
  and buyerActionsFor; assets read bounded; spec amended to match shipped rule;
  expiry copy restored; licence-status parity test added (TS + pgTAP); ilike `*`
  escaped; expired links no longer block a fresh create; dead code removed.
CRITICAL C1 OPEN — FOUNDER DECISION REQUIRED. See below.
Final re-review (opus) on ec16fd2..5892805: headline Critical genuinely closed
  (server-side, pre-signing, DB-read, three layers agree). 4 blockers found.
Final blockers closed (commit 00b5688, 219 tests): gate no longer fails OPEN on a
  read error; buyer now told why the viewing column is empty on today's default;
  spec corrected on the WATCH rule; the `*` ilike escape REVERTED (it would have
  silently killed a live link — over-matching is the safe direction); takedown
  comment corrected; hasRecipientName no longer hardcoded permissive; expiry vs
  unavailable distinguished; route-level test for /api/portal/screener added and
  MUTATION-VERIFIED (gate removed -> 2 failures; restored -> 4/4).
OPEN — FOUNDER DECISION (needs a migration, not app code):
  create_screener_link takes p_recipient_name with DEFAULT null and no non-null
  requirement on the client branch. A seated client operator can call the RPC
  from the browser client, omit the name, and mint an UNNAMED link — which the
  new gate classifies as GC-operational and therefore exempt. Not cross-tenant
  (their own master), but it is an app-layer rule doing a DB's job.
  One-line fix: raise on (not v_is_gc and p_recipient_name is null).
NEXT SLICE (founder-approved, not started): the screener proxy. Until it exists
  the buyer page shows a poster and a metadata download and nothing playable,
  because screener_source defaults to 'master' on every title.
Commit 7ee7ca4: 20260806000500_require_buyer_name.sql — client callers must pass
  a non-blank p_recipient_name. Closes the last known hole (an unnamed link was
  classified GC-operational and exempt from the stream gate). Reviewed: signature
  byte-identical so CREATE OR REPLACE replaces rather than overloads; body differs
  only by the guard; GC can still omit; plan(101) independently counted. APPROVED.
Task 10: minor (deferred): 20260806000500's header says the insertion is six lines;
  it is fourteen (the comment grew after the header was written). Accuracy nit in a
  provenance-grade file.
BRANCH COMPLETE — 34 commits. Awaiting: apply 20260806000500, then merge decision.
Commit 81752a5: pgTAP regression from the new guard fixed. FOUNDER RAN THE SUITE:
  26 files / 439 assertions PASS, screener_test 101/101. Branch fully verified.
  (The guard invalidated 3 assertions written when a client COULD mint an unnamed
  link. Two reviewers approved the migration; neither could run it. Third time
  today that reading disagreed with running.)
BRANCH COMPLETE AND GREEN — 35 commits. Ready to merge.
NEXT: transcoding / screener-proxy slice. Founder said "make it happen".
