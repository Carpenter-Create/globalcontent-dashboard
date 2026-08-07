# Screener proxy setup — MediaConvert paste-able CLI runbook

## Context
Clients deliver **platform-ready masters** — files no browser can play — and masters archive to
Glacier at 90 days (`docs/infra/portal-go-live-runbook.md` STEP 1). The buyer-facing title page
needs something it can actually show. This runbook stands up the AWS side of a pipeline that
generates one small, web-playable proxy per master: an IAM role MediaConvert assumes, the
account's MediaConvert endpoint, a queue, and read access for the app's own IAM user so a
**scheduled poll** can ask MediaConvert about job status directly.

**Amended 2026-08-07:** an earlier version of this runbook stood up an EventBridge rule, an API
destination, a connection, and an invoke role so MediaConvert could *push* a completion event to a
public callback route. The founder chose polling instead — no public write endpoint, roughly half
of this runbook's AWS setup removed, one mechanism instead of two, and testable locally (see
`docs/superpowers/specs/2026-08-06-screener-proxy-design.md` §5 for the full reasoning). Nothing
below creates an EventBridge rule, an API destination, a connection, an invoke role, or a callback
secret — if any of those show up in the AWS console for this pipeline later, they are drift, not a
convenience.

**No application code lives here** — the poll route, the job-settings builder, and the
`transcode_jobs` table are later tasks in `docs/superpowers/plans/2026-08-06-screener-proxy.md`.
This runbook produces the env vars those tasks read — `MEDIACONVERT_ENDPOINT`,
`MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_QUEUE_ARN`, `CRON_SECRET` — and the IAM grant the poll calls
with.

**Read this before running anything.** This repo has already shipped a runbook whose S3 lifecycle
rule filtered on a prefix that matched **zero objects** — the console showed a green, enabled
rule, and it archived nothing, because `assetKey()` puts `<kind>` mid-key
(`orgs/<org>/titles/<title>/<kind>/<uuid>/<file>`) and S3 lifecycle `Prefix` filters only match
from byte zero. That defect survived because the runbook's verify step only checked that the rule
*existed*, not that it *selected anything*. **Every verify step below proves selection, not
existence.** If a verify would pass against a policy or rule that matches nothing, it has been
rewritten so it can't. Don't shortcut a verify to "the resource is there" — that's exactly the
shape of the bug that shipped last time.

**Prereqs:** `aws` CLI authenticated to the GC AWS account (`aws sts get-caller-identity` returns
the GC account), `jq`, and the `vercel` CLI, linked (`vercel link`). Nothing here deletes data —
it creates new IAM/MediaConvert resources and sets env vars.

---

## STEP 0 — Fill these in, then paste this block into your shell
Replace every `<...>`. Everything below reuses these.

```bash
export AWS_REGION=us-east-1                          # match the region your assets bucket + app already use
export BUCKET=<your real assets bucket>              # e.g. gc-content-assets-prod (from asset-storage-setup)
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "acct=$ACCOUNT_ID region=$AWS_REGION bucket=$BUCKET"
```

Key layout reminder (`src/lib/assets.ts`, `assetKey()`): `orgs/<org>/titles/<title>/<kind>/<uuid>/<file>`.
`<kind>` is `master` for the source and `screener` for the proxy this pipeline writes — mid-key in
both cases, same as the archive tag's problem. The difference from the lifecycle bug: **IAM
resource-ARN wildcards are not prefix-anchored.** `*` in an IAM `Resource` matches any run of
characters *including slashes* — it behaves like `.*`, not like a filesystem glob or an S3
lifecycle `Prefix`. So `orgs/*/titles/*/master/*` correctly scopes to every master regardless of
org/title/uuid, the same way `orgs/*/titles/*/screener/*` scopes to every screener. This is why
the IAM role below can be written exactly against the real key shape instead of the brief's
shorthand `orgs/*/master/*` — write the full shape; don't rely on wildcard behavior you haven't
confirmed matches the actual key.

---

## STEP 1 — IAM role MediaConvert assumes: read masters, write screeners, nothing else

MediaConvert runs as a service, not as your CLI credentials — it needs a role it can assume with
permission to read the one input prefix and write the one output prefix this job type touches.
**Not bucket-wide**: this role must not be able to touch artwork, captions, or another org's
titles it has no reason to open.

```bash
cat > /tmp/mediaconvert-trust.json <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow",
  "Principal": { "Service": "mediaconvert.amazonaws.com" },
  "Action": "sts:AssumeRole"
} ] }
JSON
aws iam create-role --role-name gc-mediaconvert-role \
  --assume-role-policy-document file:///tmp/mediaconvert-trust.json

cat > /tmp/gc-mediaconvert-s3.json <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/orgs/*/titles/*/master/*" },
  { "Effect": "Allow", "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::$BUCKET/orgs/*/titles/*/screener/*" }
] }
JSON
aws iam put-role-policy --role-name gc-mediaconvert-role \
  --policy-name gc-mediaconvert-s3 --policy-document file:///tmp/gc-mediaconvert-s3.json
export MEDIACONVERT_ROLE_ARN=$(aws iam get-role --role-name gc-mediaconvert-role \
  --query 'Role.Arn' --output text)
echo "MEDIACONVERT_ROLE_ARN=$MEDIACONVERT_ROLE_ARN"
```

**Verify the policy actually selects a real master, not just that it parses.** `iam
simulate-principal-policy` evaluates the policy against a specific action + resource ARN and
returns an allow/deny decision — that's a selection proof, not an existence check:

```bash
# pick a real master key from the bucket:
MASTER_KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query \
  "Contents[?contains(Key, '/master/')]|[0].Key" --output text)
aws iam simulate-principal-policy --policy-source-arn "$MEDIACONVERT_ROLE_ARN" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::$BUCKET/$MASTER_KEY" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"

# and confirm the SAME role is denied on a neighboring artwork object — proves the
# scoping is real, not accidentally bucket-wide:
ART_KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query \
  "Contents[?contains(Key, '/artwork/')]|[0].Key" --output text)
aws iam simulate-principal-policy --policy-source-arn "$MEDIACONVERT_ROLE_ARN" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::$BUCKET/$ART_KEY" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "implicitDeny"
```

An "allowed"/"exists" answer on the master alone would pass even if the policy were accidentally
bucket-wide — the second call is what proves the scoping did anything.

---

## STEP 2 — The account-specific MediaConvert endpoint

MediaConvert is one of the few AWS services with a **per-account, per-region** API endpoint
instead of a shared regional one — the SDK will not connect without it, and it silently differs
between your dev/staging/prod accounts if they're separate.

```bash
export MEDIACONVERT_ENDPOINT=$(aws mediaconvert describe-endpoints --region "$AWS_REGION" \
  --query "Endpoints[0].Url" --output text)
echo "MEDIACONVERT_ENDPOINT=$MEDIACONVERT_ENDPOINT"
```

**Verify it's a working, callable endpoint** (not just a string) by using it for a real read call:

```bash
aws mediaconvert list-queues --endpoint-url "$MEDIACONVERT_ENDPOINT" --region "$AWS_REGION" \
  --query 'Queues[].Name'   # expect at least ["Default"], not an error
```

---

## STEP 3 — A queue, and explicitly no job template

MediaConvert needs a **queue** (an operational lane a job runs on) to submit a job at all — that's
not the same thing as a **job template** (a saved bundle of encoding settings). This project
creates the queue below and deliberately does **not** create a template.

```bash
aws mediaconvert create-queue --endpoint-url "$MEDIACONVERT_ENDPOINT" --region "$AWS_REGION" \
  --name gc-screener-proxy --description "Screener proxy jobs — see src/lib/mediaconvert-settings.ts" \
  --pricing-plan ON_DEMAND
export MEDIACONVERT_QUEUE_ARN=$(aws mediaconvert get-queue --endpoint-url "$MEDIACONVERT_ENDPOINT" \
  --region "$AWS_REGION" --name gc-screener-proxy --query 'Queue.Arn' --output text)
echo "MEDIACONVERT_QUEUE_ARN=$MEDIACONVERT_QUEUE_ARN"
```

**Encoding settings are submitted inline from application code** (`buildProxyJobSettings`, a later
task in this plan) on every job, not read from a saved template. That keeps the encode
specification in version control, code-reviewed, and unit-tested — a template is undiffable
console state that a later change to `buildProxyJobSettings` would silently stop matching. **Do
not create a job template for this pipeline.** If one appears later, it is drift, not a
convenience — delete it or reconcile it back into `mediaconvert-settings.ts`.

**Verify no template has been created for this**, so the "we don't do this" decision doesn't
silently rot the first time someone's in the console debugging a job:

```bash
aws mediaconvert list-job-templates --endpoint-url "$MEDIACONVERT_ENDPOINT" --region "$AWS_REGION" \
  --query 'JobTemplates[].Name'   # expect [] — re-run this check if that ever changes
```

---

## STEP 4 — the app's own MediaConvert access: submit a job, and read it back (the poll)

The role from STEP 1 is what MediaConvert *itself* assumes to run a job — it has nothing to do
with how this app's server code talks to MediaConvert. The app calls AWS using the `gc-assets-app`
IAM user's long-lived credentials (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, the same ones
`src/lib/s3.ts` and `src/lib/mediaconvert.ts` already use — see `docs/infra/asset-storage-setup.md`
STEP 4 and `docs/infra/portal-go-live-runbook.md` STEP 2 for how that user was created and what it
already has). That same user needs to do two distinct things this runbook has not yet granted:
**submit** a job (`src/lib/mediaconvert.ts`'s `submitProxyJob`, called from the upload-complete
path — already committed code, so this is not optional) and **poll** it (a later task: ask
MediaConvert about job status, then read the finished output object). Check what it already grants
before adding anything, so this doesn't duplicate a permission that's already there:

- **`s3:GetObject`, bucket-wide, is already granted** (`portal-go-live-runbook.md` STEP 2), but
  that alone is NOT enough for what the poll needs from `HeadObject`, and this was found and
  fixed only in review (fix round 1, item 1) — record it here so it isn't lost again:
  **`HeadObject` on a key that does not exist returns `404 Not Found` only if the caller ALSO
  holds `s3:ListBucket` on the bucket. Without it, S3 returns `403 Forbidden` instead** — a
  deliberate anti-enumeration behavior, so a caller who can't list the bucket can't use HEAD to
  probe which keys exist by reading the status code. `gc-assets-app`'s existing S3 policy
  (`portal-go-live-runbook.md` STEP 2) grants `GetObject`/`PutObject`/etc. but **not**
  `ListBucket`. Without it, a MediaConvert `COMPLETE` whose output object is genuinely missing
  throws `Forbidden`, not the `NotFound` `src/lib/s3.ts`'s `headObjectMeta` explicitly checks
  for — the poll logs it as "could not tell" and retries the SAME job forever, two AWS calls
  every five minutes, with nothing but a slowly rising stuck-jobs count to show for it. Granted
  below, alongside the MediaConvert actions.
- **No MediaConvert permission of any kind is granted yet, for submit or poll.** That includes
  `mediaconvert:CreateJob` — the action `submitProxyJob` calls on every master upload. Without it,
  every single upload's transcode submission fails with `AccessDenied` — silently, because
  `src/app/api/assets/complete/route.ts` deliberately swallows a transcode failure so an upload
  never breaks on account of it. One log line, no proxy, on every master ever uploaded, forever.
- **`iam:PassRole` on `gc-mediaconvert-role` is also missing, and is easy to miss entirely.**
  `CreateJob` takes a `Role` argument (`MEDIACONVERT_ROLE_ARN`, from STEP 1) and hands it to
  MediaConvert on the caller's behalf — AWS requires the caller to hold `iam:PassRole` on that
  exact role, separately from whatever `mediaconvert:CreateJob` itself allows. Granting
  `CreateJob` without `PassRole` still fails every call: AWS refuses the pass, not the job.
- `mediaconvert:GetJob` (look up a single job by id — what the poll actually calls) and
  `mediaconvert:ListJobs` (kept available in case the poll ever needs to enumerate rather than
  look up by id) are both missing too.

```bash
cat > /tmp/gc-assets-mediaconvert.json <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["mediaconvert:CreateJob","mediaconvert:ListJobs"],
    "Resource": "*" },
  { "Effect": "Allow", "Action": "mediaconvert:GetJob",
    "Resource": "arn:aws:mediaconvert:$AWS_REGION:$ACCOUNT_ID:jobs/*" },
  { "Effect": "Allow", "Action": "iam:PassRole",
    "Resource": "$MEDIACONVERT_ROLE_ARN",
    "Condition": { "StringEquals": { "iam:PassedToService": "mediaconvert.amazonaws.com" } } },
  { "Effect": "Allow", "Action": "s3:ListBucket",
    "Resource": "arn:aws:s3:::$BUCKET" }
] }
JSON
aws iam put-user-policy --user-name gc-assets-app \
  --policy-name gc-assets-mediaconvert --policy-document file:///tmp/gc-assets-mediaconvert.json
```

**`s3:ListBucket` is a BUCKET-level action, not an object one** — its `Resource` is the bucket
ARN itself (`arn:aws:s3:::$BUCKET`), never `$BUCKET/*`. That's a different shape from every
other statement in this document (and from `gc-assets-s3` in `portal-go-live-runbook.md`, which
is entirely object-level), and an easy copy-paste mistake to make if this is ever hand-edited —
`arn:aws:s3:::$BUCKET/*` on `ListBucket` is accepted by IAM (it doesn't reject the ARN shape)
but grants nothing, since `ListBucket`'s resource type is the bucket, not an object path. This
statement is deliberately UNSCOPED beyond the bucket itself (no `s3:prefix` condition): it only
grants the ability to ask "does this key exist," not to read or enumerate contents beyond what
that yes/no already reveals, and `GetObject` (already scoped nowhere near this tightly, per
`portal-go-live-runbook.md` STEP 2's bucket-wide grant) is the one that actually returns data.

This is the SAME policy name, `gc-assets-mediaconvert`, that already carries four other
statements — restated in full above, not appended-only, for the reason stated below the
`put-user-policy` call two paragraphs down: a `put-user-policy` that names only the new
statement silently drops the other four.

Two things about that document that are easy to get wrong:

- **`mediaconvert:CreateJob` (like `ListJobs`) does not support resource-level restriction** — AWS
  requires `"Resource": "*"` for both, because a job has no ARN until after it's created. That's
  the same exception STEP 4 already noted for `ListJobs`, not a new one. `GetJob`, the one action
  here that AWS *does* let you scope, stays scoped to the account's job ARNs.
- **`put-user-policy` replaces the named inline policy wholesale**, same hazard as the
  `put-bucket-lifecycle-configuration` call that once dropped an unrelated rule (see this runbook's
  intro). `gc-assets-mediaconvert` is its own policy name, separate from `gc-assets-s3` — restating
  it here does not touch `gc-assets-s3` (STEP 2 of `portal-go-live-runbook.md`) — but if `GetJob`/
  `ListJobs` were already granted under this same policy name from an earlier partial run, this
  document restates them too rather than replacing them with only the new statements. If you
  are hand-editing this JSON later, keep all FIVE actions (`CreateJob`, `ListJobs`, `GetJob`,
  `PassRole`, and now `s3:ListBucket`) in one document — a `put-user-policy` call with only the
  new ones silently deletes the rest.

**Why the `iam:PassedToService` condition, given the `Resource` is already the one specific role
ARN:** the resource scoping alone stops `gc-assets-app` from passing *some other* role, but says
nothing about *which service* it can be passed to — a `PassRole` grant is normally read alongside
whatever trust policy the target role has, and this defends the grant itself rather than leaning
on that role's trust policy (STEP 1) never changing. `gc-mediaconvert-role` is single-purpose today,
so the condition costs nothing and closes the gap if that trust policy is ever loosened later
without this policy being revisited at the same time. Belt-and-suspenders, not decorative — the
negative control below proves it's load-bearing rather than assumed.

**Verify the grant actually resolves, not just that the policy parses** — the same
`simulate-principal-policy` proof used in STEP 1, this time against `gc-assets-app`, covering all
five actions plus two negative controls:

```bash
export GC_ASSETS_APP_ARN=$(aws iam get-user --user-name gc-assets-app --query 'User.Arn' --output text)

# CreateJob — the actual action submitProxyJob calls:
aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names mediaconvert:CreateJob --resource-arns "*" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"

# PassRole on the exact MediaConvert role, in the context CreateJob actually calls it in
# (passed TO the mediaconvert service) — --context-entries supplies the condition key the
# real CreateJob call would carry, so this evaluates the condition, not just the Resource match:
aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names iam:PassRole --resource-arns "$MEDIACONVERT_ROLE_ARN" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=mediaconvert.amazonaws.com,ContextKeyType=string \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"

aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names mediaconvert:GetJob \
  --resource-arns "arn:aws:mediaconvert:$AWS_REGION:$ACCOUNT_ID:jobs/1234567890123-abcdef" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed" — any job id string works here,
  # the policy isn't scoped to a specific job

aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names mediaconvert:ListJobs --resource-arns "*" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"

# ListBucket — the addition from fix round 1, item 1. Resource is the BUCKET ARN, not
# "$BUCKET/*" — a ListBucket check against the object-style ARN would evaluate against the
# wrong resource type and could pass or fail for the wrong reason:
aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names s3:ListBucket --resource-arns "arn:aws:s3:::$BUCKET" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"

# Negative control 1 — PassRole must be denied for a DIFFERENT role ARN, proving the Resource
# really is the one specific role and not accidentally "*":
aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names iam:PassRole --resource-arns "arn:aws:iam::$ACCOUNT_ID:role/some-unrelated-role" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=mediaconvert.amazonaws.com,ContextKeyType=string \
  --query 'EvaluationResults[0].EvalDecision'   # expect "implicitDeny"

# Negative control 2 — the SAME correct role ARN must be denied if the context claims it's being
# passed to a DIFFERENT service, proving the iam:PassedToService condition is actually evaluated
# and not silently ignored:
aws iam simulate-principal-policy --policy-source-arn "$GC_ASSETS_APP_ARN" \
  --action-names iam:PassRole --resource-arns "$MEDIACONVERT_ROLE_ARN" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=ec2.amazonaws.com,ContextKeyType=string \
  --query 'EvaluationResults[0].EvalDecision'   # expect "implicitDeny"
```

An `implicitDeny` on `CreateJob` or `PassRole` is the exact gap this STEP exists to close: every
master upload would submit, `completeMultipart` and `create_asset` would both succeed, and
`submitProxyJob`'s `AccessDenied` would land in `src/app/api/assets/complete/route.ts`'s
catch block — logged, swallowed, and never surfaced to a client or GC user, because that
swallow exists precisely so a transcode problem never breaks an upload. No screener would ever be
produced, for any title, and nothing short of reading server logs would show it. An `implicitDeny`
on `GetJob`/`ListJobs` means the poll (built: `src/app/api/cron/transcode-poll`) will run on
schedule forever, call `GetJob`, get an `AccessDenied`, and silently never register a proxy — the
stuck-jobs signal the poll itself produces would eventually surface that, but catching either
failure here is one command instead of a production incident.

An `implicitDeny` on `s3:ListBucket` is quieter than either of those and easy to mistake for
something else entirely: `HeadObject` on a genuinely-missing key returns `403 Forbidden` instead
of `404 Not Found` without it (see the bullet above), which `src/lib/s3.ts`'s `headObjectMeta`
treats as "could not tell" rather than "confirmed absent" — so a MediaConvert job whose output
really is missing gets re-checked every five minutes, forever, two AWS calls a tick, and the only
externally visible symptom is a stuck-jobs count that climbs without ever explaining why.

---

## STEP 5 — Env vars: local and Vercel, all server-only

**Two platform facts about `vercel.json`'s `crons` array, worth recording beside it rather than
only in code comments, because they change what "the poll never ran" means when diagnosing an
incident:**

1. **`*/5 * * * *` (minute-level granularity) requires Vercel Pro or above.** Hobby-tier crons
   are limited to once per day. If this schedule is ever silently downgraded to daily, that's a
   plan change, not a code regression — check the account tier before assuming the code broke.
2. **Vercel invokes crons only against PRODUCTION deployments — never preview.** There is no
   preview equivalent to repeat env vars into for the cron ITSELF to fire on preview; setting
   `CRON_SECRET`/the `MEDIACONVERT_*` vars under `preview` (below) only means the route would
   *authenticate correctly if something else called it* on a preview deploy — Vercel's own
   dispatcher still won't. A preview that "looks fine" proves nothing about whether the cron is
   wired up at all; only a production deploy does.

```bash
printf '%s' "$MEDIACONVERT_ENDPOINT"        | vercel env add MEDIACONVERT_ENDPOINT production
printf '%s' "$MEDIACONVERT_ROLE_ARN"        | vercel env add MEDIACONVERT_ROLE_ARN production
printf '%s' "$MEDIACONVERT_QUEUE_ARN"       | vercel env add MEDIACONVERT_QUEUE_ARN production
export CRON_SECRET=$(openssl rand -hex 32)
printf '%s' "$CRON_SECRET"                  | vercel env add CRON_SECRET production
# repeat each for `preview` only if something OTHER than Vercel's own cron dispatcher (e.g. a
# manual curl during testing) needs to authenticate against a preview deploy — see the two
# platform facts above.
vercel env ls | grep -Ei 'mediaconvert|cron_secret'   # verify all four, and NONE prefixed NEXT_PUBLIC_
# mirror the same 4 into .env.local for local testing (never commit that file).
vercel --prod        # redeploy so the new env takes effect, and vercel.json's cron registers
```

**All four are server-only. None may ever carry a `NEXT_PUBLIC_` prefix.** This app ships a
browser Supabase client — anything under `NEXT_PUBLIC_` ends up in that bundle, readable by
anyone. `CRON_SECRET` is what stops anyone but Vercel's own cron dispatcher from triggering
`/api/cron/transcode-poll` — a route that (once built) writes a `screener` asset row without going
through the normal RLS-checked upload path. Unlike the callback secret this replaces, nothing in
this repo *sends* `CRON_SECRET` anywhere: Vercel reads the env var directly and attaches it as
`Authorization: Bearer $CRON_SECRET` when it invokes the route on schedule — there is no
connection, destination, or invoke role to wire up on the AWS side at all. Treat it like a
credential, not a config value.

**Verify none leaked into the client bundle**, don't just eyeball the `vercel env ls` output —
that only proves the var exists server-side, not that it's absent from what ships to browsers.
**Grep for the VALUES, never the variable names**: Next.js's build-time substitution replaces
`process.env.NEXT_PUBLIC_X` with the literal string value at compile time — the name `X` never
appears anywhere in the output bundle, only whatever it was set to. A name-based grep would print
`clean` even if the secret itself were sitting in plain sight in a `.js` file, because the thing
it's searching for was never going to be there regardless of whether the leak happened. Grep for
the four actual captured values, which are still in shell scope from STEPS 1–5:

```bash
pnpm build
for v in "$CRON_SECRET" "$MEDIACONVERT_ROLE_ARN" "$MEDIACONVERT_QUEUE_ARN" "$MEDIACONVERT_ENDPOINT"; do
  grep -R -F -q -- "$v" .next/static 2>/dev/null && echo "LEAK FOUND: $v — do not deploy"
done
echo "checked — no output above the 'checked' line means none of the four values are in the client bundle"
```

---

## End-to-end verification (do all of these — a green console at every step above is not proof)

A permission grant that resolves to `implicitDeny` on the one action that matters looks
**identical**, in the console, to one that works: same policy JSON, same "attached" status, same
zero errors, because there's nothing to error on if the thing that would use it is never called.
That's precisely how the lifecycle prefix bug shipped. The checks above proved each piece in
isolation; these prove the pieces work **together**, moving a real object through the real path.

1. **Submit one real job against a known master and confirm output lands where expected.**
   Until `buildProxyJobSettings` (a later task) exists, submit a minimal settings document by hand
   so this pipeline is proven before any application code depends on it. **`RateControlMode:
   QVBR` requires its companion `QvbrSettings.QvbrQualityLevel`** — MediaConvert rejects the job
   at submission with a `ValidationException` if it's absent, which means `TEST_JOB_ID` below
   comes back empty and every check after it (output object, tag check) has nothing to observe. `QvbrQualityLevel` is 1–10; `7` is a reasonable mid-high default for a
   review proxy, not a tuned production value:
   ```bash
   MASTER_KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query \
     "Contents[?contains(Key, '/master/')]|[0].Key" --output text)
   # mirrors proxyOutputKey(): same org/title/uuid segment, kind swapped to screener
   OUTPUT_DEST=$(echo "$MASTER_KEY" | sed -E 's#(orgs/[^/]+/titles/[^/]+)/master/([^/]+)/.*#\1/screener/\2/#')
   cat > /tmp/test-job-settings.json <<JSON
   { "Role": "$MEDIACONVERT_ROLE_ARN", "Queue": "$MEDIACONVERT_QUEUE_ARN",
     "Settings": { "Inputs": [ { "FileInput": "s3://$BUCKET/$MASTER_KEY" } ],
       "OutputGroups": [ { "Name": "File Group",
         "OutputGroupSettings": { "Type": "FILE_GROUP_SETTINGS",
           "FileGroupSettings": { "Destination": "s3://$BUCKET/$OUTPUT_DEST" } },
         "Outputs": [ { "ContainerSettings": { "Container": "MP4", "Mp4Settings": { } },
           "VideoDescription": { "CodecSettings": { "Codec": "H_264",
             "H264Settings": { "RateControlMode": "QVBR", "MaxBitrate": 2500000,
               "QvbrSettings": { "QvbrQualityLevel": 7 } } } },
           "AudioDescriptions": [ { "CodecSettings": { "Codec": "AAC",
             "AacSettings": { "Bitrate": 128000, "CodingMode": "CODING_MODE_2_0", "SampleRate": 48000 } } } ],
           "NameModifier": "_screener" } ] } ] } }
   JSON
   export TEST_JOB_ID=$(aws mediaconvert create-job --endpoint-url "$MEDIACONVERT_ENDPOINT" \
     --region "$AWS_REGION" --cli-input-json file:///tmp/test-job-settings.json \
     --query 'Job.Id' --output text)
   # confirm the job was actually ACCEPTED before polling it — a rejected create-job call
   # (a ValidationException, e.g. from a missing required companion field) still exits the
   # CLI, and an empty/"None" TEST_JOB_ID would otherwise make every later check pass
   # trivially by finding nothing to disagree with:
   [ -n "$TEST_JOB_ID" ] && [ "$TEST_JOB_ID" != "None" ] || { echo "job submission failed — read the create-job error above, do not proceed"; }
   # poll until COMPLETE (minutes, depends on source length):
   aws mediaconvert get-job --endpoint-url "$MEDIACONVERT_ENDPOINT" --region "$AWS_REGION" \
     --id "$TEST_JOB_ID" --query 'Job.Status'
   # once COMPLETE, confirm the EXACT expected object NAME exists — not just that something
   # landed under the prefix. The poll will check register_transcode_output's p_storage_key
   # against transcode_jobs.expected_output_key for an EXACT match (that's the single check
   # stopping the poll from registering an arbitrary S3 object as a screener if MediaConvert's
   # response were ever untrustworthy), so "a file exists somewhere under this prefix" is not
   # the contract that matters — "a file exists at exactly this key" is. Mirrors
   # proxyOutputKey()'s own basename+suffix derivation (src/lib/mediaconvert-settings.ts):
   # strip the master's extension, append the NameModifier, force .mp4.
   MASTER_BASENAME=$(basename "$MASTER_KEY")
   EXPECTED_OUTPUT_KEY="${OUTPUT_DEST}${MASTER_BASENAME%.*}_screener.mp4"
   aws s3api head-object --bucket "$BUCKET" --key "$EXPECTED_OUTPUT_KEY" >/dev/null \
     && echo "confirmed: object exists at the exact expected key ($EXPECTED_OUTPUT_KEY)" \
     || echo "MISSING at the exact expected key ($EXPECTED_OUTPUT_KEY) — do not proceed; list-objects below to see what actually landed"
   aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$OUTPUT_DEST"   # for comparison only
   ```

This runbook proves the AWS side end-to-end: a job can be submitted and its output lands at the
exact key the poll will look for. It stops short of proving the app's own credentials can read
that job back — STEP 4's `simulate-principal-policy` check is a deliberate proxy for that,
mirroring the identical choice STEP 1 makes for the service role, rather than exporting
`gc-assets-app`'s long-lived secret key into this shell for one command. The last mile — a real
poll invocation, with `CRON_SECRET`, against `$TEST_JOB_ID`, actually calling
`register_transcode_output` — needs application code this runbook doesn't produce, and is the
plan's Task 5's own manual step instead.

2. **Confirm the produced proxy is NOT archive-tagged.** Masters are tagged
   `gc-archive=master` at `CreateMultipartUpload` (`src/lib/s3.ts`), and the Glacier lifecycle rule
   selects on that tag alone — so an object MediaConvert writes carries no tag and stays instant
   *by default*. But "a screener that never goes cold" is the entire point of this pipeline, not
   an incidental property, and it costs one command to stop assuming and start confirming:
   ```bash
   OUTPUT_KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$OUTPUT_DEST" \
     --query 'Contents[0].Key' --output text)
   aws s3api get-object-tagging --bucket "$BUCKET" --key "$OUTPUT_KEY"
   # expect: {"TagSet": []} — no gc-archive tag of any value. If one is ever present, the proxy
   # will silently transition to Glacier at 90 days and the buyer page will start 404ing screeners.
   ```

Record pass/fail against both before treating this pipeline as live. **A role or policy that shows
green in its own console and has never moved a real object through the whole path is unverified,
not working.**
