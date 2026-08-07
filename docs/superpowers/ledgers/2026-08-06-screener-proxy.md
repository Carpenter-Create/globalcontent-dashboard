# SDD ledger — plan: docs/superpowers/plans/2026-08-06-screener-proxy.md

Branch: feat/screener-proxy (from 283ec35, itself off feat/buyer-title-page @ 81752a5)
Pre-flight: Task 1 is a runbook the FOUNDER applies; Task 2 writes SQL and STOPS for
approval. Tasks 4-7 can be built and unit-tested without AWS, but cannot be verified
end-to-end until MediaConvert exists in the account. The spec makes one real master
through the real pipeline mandatory before any backfill.
Founder decisions already made: (1) screener_source flips ONLY from the 'master'
default, never overriding an explicit 'dedicated'; (2) backfill is one pass, ~700
titles, ~$700, executed by the founder — no task here spends money.

Proxy T1: implemented (commit b2dc68a). Implementer CORRECTED AN ERROR IN MY BRIEF:
  I wrote the IAM resource as orgs/*/master/* — the same mid-key mistake that made
  the Glacier rule match zero objects. Real shape is orgs/*/titles/*/master/*.
  They proved the fix with iam simulate-principal-policy rather than asserting it.
Proxy T1: review — spec OK, NOT approved, 2 Critical:
  (a) the one-real-job verification cannot run: QVBR rate control without
      QvbrSettings fails validation, so every downstream check observes nothing.
  (b) the leak check greps for env var NAMES; Next.js inlines the VALUE, so a real
      leaked callback secret would print "clean". The document's own thesis
      failing on the document's own security step.
  + EventBridge trust policy has no aws:SourceArn condition (confused deputy).
Proxy T1: fix round 1/5 dispatched.
Proxy T1: fix round 1/5 (3 addressed; b2dc68a..7d53236). Reviewer built a
  per-verification table for the whole runbook: every other check proves
  observable state. STEP 6 was the only instance of the defect class.
Proxy T1: complete (commits 283ec35..7d53236, review clean)
Proxy T1: minor (deferred): the TEST_JOB_ID guard prints but does not exit, so a
  pasted block continues past a rejected create-job (AWS CLI then errors loudly).
Proxy T1: minor (deferred): grep -q drops the matched file/line, trading location
  for per-secret attribution.
Proxy T1: accepted limitation: the confused-deputy check is existence-based. IAM
  simulate does not model a service principal's AssumeRole with AWS-injected
  aws:SourceArn, so behavioural proof would need a throwaway rule. Labelled
  honestly in the doc rather than dressed up as equivalent to the other proofs.
Proxy T2: implemented (commit 18c1746, plan 44). Spec OK. NOT approved.
Proxy T2: CRITICAL — a NULL p_storage_key bypasses the key check entirely.
  btrim(NULL) is NULL; NULL <> 'key' is NULL; `if NULL then` does not branch, so
  execution falls through to the insert. Reachable by a malformed EventBridge
  payload, no attacker needed. Registers a screener for a nonexistent object,
  flips screener_source so the portal stops serving the master and 404s every
  live buyer link on that title, and locks the job complete with no recovery
  path through any RPC (the asset is immutable and never deleted).
Proxy T2: + read-then-write idempotency with no FOR UPDATE (at-least-once
  delivery is the case the header names and does not handle); grant update to
  service_role defeats the key check entirely; missing revoke-all-from-anon and
  service_role keeps DELETE — invisible on a fresh rebuild, appears only in
  production; content_hash/bytes unvalidated into an immutable provenance field;
  expected_output_key not unique so a retry can register twice.
Proxy T2: fix round 1/5 dispatched.
Proxy T2: fix round 1 (agent died on an API error AFTER completing the work and
  BEFORE committing; coordinator committed as a0033de, honestly labelled).
  Verified closed: the NULL bypass, FOR UPDATE serialisation, anon revoke,
  DELETE revoke, content_hash/bytes validation, kind check, plan 44->53.
Proxy T2: fix round 2 (b85b843, plan 61) — but the FIRST fix was itself
  incomplete: removing the explicit `grant update to service_role` did NOT remove
  the IMPLICIT one, because on the production image new tables arrive with full
  DML. service_role kept INSERT/UPDATE and is BYPASSRLS, so the callback could
  have updated the job row directly and skipped the key check — the exact threat
  the header claimed to close. Now an unconditional revoke-all + grant-select,
  identical on both images.
  Also caught FORWARD: a flat UNIQUE on the deterministic output key would have
  made Task 7's retry raise 23505 forever. Replaced with a partial unique.
Proxy T2: fix round 3/5 dispatched — the partial index released the key on
  'complete', so a retry after a SUCCESSFUL registration produced a second
  immutable asset at the same key (portal serves the newer, the older is orphaned
  describing an overwritten object). One-word predicate fix. Plus a tenant-scope
  guard on the client-supplied expected_output_key.
NOTE: three rounds running, the implementer's report has overstated a grep result
  each time. Substantive conclusions held; the verification claims did not.
Proxy T2: fix round 4 (dbe82e2, plan 64) — test role corrected, reachability
  claim fixed (a re-upload does NOT collide; assetKey mints a fresh UUID — the
  real path is a resubmit against the SAME assets row, which T6/T7 must handle),
  scope check made NULL-safe and anchored on the screener segment.
Proxy T2: coordinator fixed one mechanical type cast directly (assets.bytes is
  bigint, literal was integer, pgTAP is() needs matching types — the file aborted
  at assertion 40/64). Commit 3c9840a. No review cycle spent on a cast.
Proxy T2: APPLIED by founder. 27 files / 503 assertions PASS, transcode_jobs 64.
PROCESS CHANGE (founder, 2026-08-07): full review stays on the database and any
  publicly reachable endpoint. Ordinary code gets one review pass instead of a
  fix/re-review loop, and the saved effort goes into ACTUALLY RUNNING things —
  today's end-to-end run found what four reviews missed.
Proxy T3+T4: implemented (a3760d6, 1c1cf86), types trap fixed (28949f0).
  Review NOT approved: 2 Critical. (a) encoding settings paired VBR with
  MaxBitrate, a QVBR-only field — AWS would reject every job, silently, because
  T4 swallows transcode errors. Notably the settings PROVEN against real AWS in
  the runbook were not the settings the code sent. (b) detach requires the
  unapplied 20260807000200. Plus: filename regex matched '/', no test tied the
  derived key to the SQL that must accept it, uppercase UUIDs defeat the LIKE.
Proxy T3+T4: fixed (a32ebe9, plan 65, 243 tests) — settings now match the proven
  QVBR shape verbatim, justified against SDK doc strings.
TYPES TRAP (found by RUNNING the generator, not reading): database.types.ts held
  a hand-edit the generator reverts. Regenerating silently broke the build, with
  the error pointing at a call site rather than the cause. Root-caused to a
  missing SQL DEFAULT; fixed at the SQL level so no hand-edit is needed.
ARCHITECTURE CHANGE (founder, 2026-08-07): POLL, not push. Deletes the public
  callback endpoint, the shared secret, EventBridge, the API destination and its
  confused-deputy trust policy. Tasks 5+6 merged into one scheduled poll.
  Vercel Pro confirmed — minute-level cron available. Spec/plan/runbook revised
  (e9f043a). Renumbered: 5 poll, 6 GC visibility, 7 spec amendment, 8 backfill.
IAM GAP (found during replan): the runbook granted the MediaConvert SERVICE its
  permissions but never granted the APP mediaconvert:CreateJob or iam:PassRole.
  Submission would have failed access-denied on every master — silently, since
  T4 swallows it. Fixed (d6e89df), PassRole scoped with iam:PassedToService, and
  all four actions restated so a re-run cannot drop the earlier GetJob/ListJobs.
20260807000200 APPLIED by founder — detach on buyer links works again. 504 pgTAP.
Types verified by REGENERATING against the applied DB: the p_vendor_id?: string
  prediction held, but the Enums constants array was still missing
  transcode_status (the earlier pass fixed the type union only). Fixed. The file
  now differs from generated output by exactly 4 comment lines.
Proxy T5: implemented (60d1a8b, 261 tests, auth mutation-verified). Review NOT
  approved — 6 Important. The two best were an interaction no single file shows:
  (a) gc-assets-app has no s3:ListBucket, so HeadObject on a MISSING object
      returns 403 not 404 — the "object absent" branch can never fire in prod,
      and such a job is re-polled every 5 minutes forever.
  (b) the same 404 check also matches NoSuchBucket, so a wrong/unset S3_BUCKET
      would mark every SUCCESSFUL transcode permanently failed — effectively
      irreversible (register refuses non-active jobs, nothing is ever deleted).
  headObjectMeta — the branch deciding "permanently failed" — had NO tests.
  Also: the bounded/status-filtered select test passes against a route with
  neither; the stuck signal cannot report its own absence; no maxDuration on a
  serial loop over up to 500 jobs x 2 AWS calls.

=== OPEN SECURITY FINDING — founder call, 2026-08-07 ===
Surfaced while rewriting the B3 cross-org isolation harness. Not blocking the
merge (both halves are already in these branches; merging does not worsen it),
but it is a real bypass of a control we deliberately built.

WHAT: unification (20260806000300) removed `not is_gc_staff(created_by)` from
portal_links_select, so a client can read GC's OWN unnamed screener link on
their title — including its raw share_token. Separately, the interim stream gate
exempts unnamed links from the master-source refusal so GC's operational review
links keep working.

TOGETHER: a client can lift GC's link token, open the portal, pass the OTP with
any email they control, and stream the master. That is the same bypass
20260806000500 closed on the WRITE path (a client must name a buyer), reopened
through the READ path.

SEVERITY: it is their own title and their own master — they could already
download it and hand it to anyone — so this is not an escalation of what data
they can reach. It is a control that can be walked around, which tends to be
discovered at the worst moment.

LIKELY FIX: stop exempting unnamed links once GC's review flow has a real
dedicated screener, which the proxy work delivers anyway. Until then, either
narrow the read policy to hide GC-authored share_tokens (partially reversing a
founder transparency decision), or accept it knowingly.

NOT encoded as a B3 probe: same-org, so out of that harness's scope.
