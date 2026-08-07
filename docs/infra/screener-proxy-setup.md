# Screener proxy setup — MediaConvert paste-able CLI runbook

## Context
Clients deliver **platform-ready masters** — files no browser can play — and masters archive to
Glacier at 90 days (`docs/infra/portal-go-live-runbook.md` STEP 1). The buyer-facing title page
needs something it can actually show. This runbook stands up the AWS side of a pipeline that
generates one small, web-playable proxy per master: an IAM role MediaConvert assumes, the
account's MediaConvert endpoint, an EventBridge rule that notices job completion, and an API
destination that delivers that notice to this app. **No application code lives here** — the
callback route, the job-settings builder, and the `transcode_jobs` table are later tasks in
`docs/superpowers/plans/2026-08-06-screener-proxy.md`. This runbook only produces the env vars
those tasks read: `MEDIACONVERT_ENDPOINT`, `MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_QUEUE_ARN`,
`TRANSCODE_CALLBACK_SECRET`.

**Read this before running anything.** This repo has already shipped a runbook whose S3 lifecycle
rule filtered on a prefix that matched **zero objects** — the console showed a green, enabled
rule, and it archived nothing, because `assetKey()` puts `<kind>` mid-key
(`orgs/<org>/titles/<title>/<kind>/<uuid>/<file>`) and S3 lifecycle `Prefix` filters only match
from byte zero. That defect survived because the runbook's verify step only checked that the rule
*existed*, not that it *selected anything*. **Every verify step below proves selection or
delivery, not existence.** If a verify would pass against a rule that matches nothing, or a
destination that receives nothing, it has been rewritten so it can't. Don't shortcut a verify to
"the resource is there" — that's exactly the shape of the bug that shipped last time.

**Prereqs:** `aws` CLI authenticated to the GC AWS account (`aws sts get-caller-identity` returns
the GC account), `jq`, and the `vercel` CLI, linked (`vercel link`). Nothing here deletes data —
it creates new IAM/MediaConvert/EventBridge resources and sets env vars.

---

## STEP 0 — Fill these in, then paste this block into your shell
Replace every `<...>`. Everything below reuses these.

```bash
export AWS_REGION=us-east-1                          # match the region your assets bucket + app already use
export BUCKET=<your real assets bucket>              # e.g. gc-content-assets-prod (from asset-storage-setup)
export APP_ORIGIN=https://<your app origin>           # this app's own URL, e.g. https://app.globalcontent.co
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "acct=$ACCOUNT_ID region=$AWS_REGION bucket=$BUCKET origin=$APP_ORIGIN"
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

## STEP 4 — EventBridge rule: only the three terminal MediaConvert states

AWS service events (like MediaConvert's) land on the account's **default event bus**
automatically — no subscription step. What needs creating is a rule that picks the completion
signal out of that stream and only the terminal states, so a job stuck in `PROGRESSING` for hours
doesn't trigger anything.

```bash
cat > /tmp/mediaconvert-rule-pattern.json <<JSON
{
  "source": ["aws.mediaconvert"],
  "detail-type": ["MediaConvert Job State Change"],
  "detail": { "status": ["COMPLETE", "ERROR", "CANCELED"] }
}
JSON
aws events put-rule --name gc-transcode-job-state \
  --event-pattern file:///tmp/mediaconvert-rule-pattern.json \
  --state ENABLED
# rule ARNs on the default bus are deterministic — capture it now, STEP 5's invoke role trust
# policy pins to this exact ARN so no other rule in the account can assume that role:
export TRANSCODE_RULE_ARN="arn:aws:events:$AWS_REGION:$ACCOUNT_ID:rule/gc-transcode-job-state"
```

**Verify the pattern actually selects the states it's supposed to — and rejects the ones it
isn't.** `test-event-pattern` evaluates a real sample event against the pattern; testing only the
positive case is exactly the kind of check that would also pass for an accidentally-broader
pattern (e.g. one that matched every status). Test both directions:

```bash
cat > /tmp/sample-complete.json <<JSON
{
  "version": "0", "id": "11111111-1111-1111-1111-111111111111",
  "detail-type": "MediaConvert Job State Change", "source": "aws.mediaconvert",
  "account": "$ACCOUNT_ID", "time": "2026-08-06T00:00:00Z", "region": "$AWS_REGION",
  "resources": ["arn:aws:mediaconvert:$AWS_REGION:$ACCOUNT_ID:jobs/1234567890123-abcdef"],
  "detail": { "timestamp": 1700000000000, "accountId": "$ACCOUNT_ID",
    "queue": "$MEDIACONVERT_QUEUE_ARN", "jobId": "1234567890123-abcdef", "status": "COMPLETE" }
}
JSON
aws events test-event-pattern --event-pattern file:///tmp/mediaconvert-rule-pattern.json \
  --event file:///tmp/sample-complete.json   # expect true

# swap ONLY the status and re-test — a rule that matches everything would also say true here:
sed 's/"COMPLETE"/"PROGRESSING"/' /tmp/sample-complete.json > /tmp/sample-progressing.json
aws events test-event-pattern --event-pattern file:///tmp/mediaconvert-rule-pattern.json \
  --event file:///tmp/sample-progressing.json   # expect false
```

If the second call also prints `true`, the pattern is too loose (probably a typo dropped the
`detail.status` filter) and every intermediate state will fire the callback below.

---

## STEP 5 — API destination + connection: EventBridge → this app, with a shared secret

The callback route this pipeline calls is public (EventBridge can't hold your app's session
cookies), so it authenticates by a shared-secret header that only EventBridge and the app know.
An EventBridge **connection** with `API_KEY` auth is what injects that header on every delivery —
the app never has to trust the request body's shape to prove who sent it.

```bash
export TRANSCODE_CALLBACK_SECRET=$(openssl rand -hex 32)

aws events create-connection --name gc-transcode-callback \
  --authorization-type API_KEY \
  --auth-parameters '{"ApiKeyAuthParameters":{"ApiKeyName":"X-Transcode-Callback-Secret","ApiKeyValue":"'"$TRANSCODE_CALLBACK_SECRET"'"}}'
export CONNECTION_ARN=$(aws events describe-connection --name gc-transcode-callback \
  --query 'ConnectionArn' --output text)

aws events create-api-destination --name gc-transcode-callback \
  --connection-arn "$CONNECTION_ARN" \
  --invocation-endpoint "$APP_ORIGIN/api/transcode/callback" \
  --http-method POST --invocation-rate-limit-per-second 5
export API_DESTINATION_ARN=$(aws events describe-api-destination --name gc-transcode-callback \
  --query 'ApiDestinationArn' --output text)

# EventBridge needs its OWN role to invoke an API destination on your behalf. The trust policy is
# scoped with aws:SourceArn (+ aws:SourceAccount as defense in depth) to THIS rule specifically —
# EventBridge's confused-deputy pattern: a bare "Service": "events.amazonaws.com" principal with
# no condition lets ANY rule ever created in this account (by anyone, for anything) assume this
# role and invoke the API destination that writes screener assets. Pinning to the rule ARN means
# only gc-transcode-job-state can use it.
cat > /tmp/eb-invoke-trust.json <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow", "Principal": { "Service": "events.amazonaws.com" }, "Action": "sts:AssumeRole",
  "Condition": {
    "ArnLike": { "aws:SourceArn": "$TRANSCODE_RULE_ARN" },
    "StringEquals": { "aws:SourceAccount": "$ACCOUNT_ID" }
  }
} ] }
JSON
aws iam create-role --role-name gc-eventbridge-invoke-role \
  --assume-role-policy-document file:///tmp/eb-invoke-trust.json
cat > /tmp/eb-invoke-policy.json <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow", "Action": "events:InvokeApiDestination", "Resource": "$API_DESTINATION_ARN"
} ] }
JSON
aws iam put-role-policy --role-name gc-eventbridge-invoke-role \
  --policy-name gc-invoke-transcode-callback --policy-document file:///tmp/eb-invoke-policy.json
export EB_INVOKE_ROLE_ARN=$(aws iam get-role --role-name gc-eventbridge-invoke-role \
  --query 'Role.Arn' --output text)

aws events put-targets --rule gc-transcode-job-state --targets \
  "[{\"Id\":\"1\",\"Arn\":\"$API_DESTINATION_ARN\",\"RoleArn\":\"$EB_INVOKE_ROLE_ARN\"}]"
```

**Header name matters downstream:** the later callback route (Task 5 of the plan) must read the
exact header `X-Transcode-Callback-Secret` and compare it timing-safely against
`TRANSCODE_CALLBACK_SECRET`. If that route ever reads a different header name, this connection is
delivering a secret nobody checks.

**Verify the target is wired, not just declared** — `list-targets-by-rule` only proves the JSON
exists; a rule can have a perfectly-formed target and still never fire if IAM denies the invoke.
Confirm the *permission* resolves too:

```bash
aws events list-targets-by-rule --rule gc-transcode-job-state   # target present
aws iam simulate-principal-policy --policy-source-arn "$EB_INVOKE_ROLE_ARN" \
  --action-names events:InvokeApiDestination --resource-arns "$API_DESTINATION_ARN" \
  --query 'EvaluationResults[0].EvalDecision'   # expect "allowed"
```

**Verify the confused-deputy condition is actually on the role, scoped to the right rule** — this
one is an honest exception to "prove selection, not existence": IAM's policy simulator evaluates
identity- and resource-based policies against an action/resource pair, but it does not model
`sts:AssumeRole` trust-policy conditions the way a real cross-account/cross-rule attempt would, so
there is no CLI call that behaviorally proves "a different rule cannot assume this." Proving that
for real would mean standing up a second, throwaway EventBridge rule and attempting the exploit —
disproportionate for a config check. So this check confirms the condition is present and pinned to
the exact rule, which is the strongest available proof short of that:

```bash
aws iam get-role --role-name gc-eventbridge-invoke-role \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition'
# expect ArnLike.aws:SourceArn to equal $TRANSCODE_RULE_ARN exactly (not a wildcard broader than
# the one rule) and StringEquals.aws:SourceAccount to equal $ACCOUNT_ID
```

Actual end-to-end delivery (a request landing at `$APP_ORIGIN/api/transcode/callback`) can only be
proven once a real job runs — see the end-to-end verification section below.

---

## STEP 6 — Env vars: local and Vercel, all four server-only

```bash
printf '%s' "$MEDIACONVERT_ENDPOINT"        | vercel env add MEDIACONVERT_ENDPOINT production
printf '%s' "$MEDIACONVERT_ROLE_ARN"        | vercel env add MEDIACONVERT_ROLE_ARN production
printf '%s' "$MEDIACONVERT_QUEUE_ARN"       | vercel env add MEDIACONVERT_QUEUE_ARN production
printf '%s' "$TRANSCODE_CALLBACK_SECRET"    | vercel env add TRANSCODE_CALLBACK_SECRET production
# repeat each for `preview` if the callback should also work against preview deploys.
vercel env ls | grep -Ei 'mediaconvert|transcode_callback'   # verify all four, and NONE prefixed NEXT_PUBLIC_
# mirror the same 4 into .env.local for local testing (never commit that file).
vercel --prod        # redeploy so the new env takes effect
```

**All four are server-only. None may ever carry a `NEXT_PUBLIC_` prefix.** This app ships a
browser Supabase client — anything under `NEXT_PUBLIC_` ends up in that bundle, readable by
anyone. `TRANSCODE_CALLBACK_SECRET` specifically gates the one route that writes a `screener`
asset row without going through the normal RLS-checked upload path: leak it, and anyone can POST
a fabricated completion event and register an arbitrary S3 object as the screener on any title —
which is what the buyer page then serves. Treat it like a credential, not a config value.

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
for v in "$TRANSCODE_CALLBACK_SECRET" "$MEDIACONVERT_ROLE_ARN" "$MEDIACONVERT_QUEUE_ARN" "$MEDIACONVERT_ENDPOINT"; do
  grep -R -F -q -- "$v" .next/static 2>/dev/null && echo "LEAK FOUND: $v — do not deploy"
done
echo "checked — no output above the 'checked' line means none of the four values are in the client bundle"
```

---

## End-to-end verification (do all of these — a green console at every step above is not proof)

A rule that matches nothing looks **identical**, in the console, to a rule that works: same
"Enabled" badge, same JSON, same zero errors, because there's nothing to error on if nothing ever
reaches it. That's precisely how the lifecycle prefix bug shipped. The checks above proved each
piece in isolation; these prove the pieces work **together**, moving a real object through the
real path.

1. **Submit one real job against a known master and confirm output lands where expected.**
   Until `buildProxyJobSettings` (a later task) exists, submit a minimal settings document by hand
   so this pipeline is proven before any application code depends on it. **`RateControlMode:
   QVBR` requires its companion `QvbrSettings.QvbrQualityLevel`** — MediaConvert rejects the job
   at submission with a `ValidationException` if it's absent, which means `TEST_JOB_ID` below
   comes back empty and every check after it (output object, EventBridge match, invocation count,
   tag check) has nothing to observe. `QvbrQualityLevel` is 1–10; `7` is a reasonable mid-high
   default for a review proxy, not a tuned production value:
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
   # landed under the prefix. The callback route will check register_transcode_output's
   # p_storage_key against transcode_jobs.expected_output_key for an EXACT match (that's the
   # single check stopping a forged event from registering an arbitrary S3 object as a
   # screener), so "a file exists somewhere under this prefix" is not the contract that matters
   # — "a file exists at exactly this key" is. Mirrors proxyOutputKey()'s own basename+suffix
   # derivation (src/lib/mediaconvert-settings.ts): strip the master's extension, append the
   # NameModifier, force .mp4.
   MASTER_BASENAME=$(basename "$MASTER_KEY")
   EXPECTED_OUTPUT_KEY="${OUTPUT_DEST}${MASTER_BASENAME%.*}_screener.mp4"
   aws s3api head-object --bucket "$BUCKET" --key "$EXPECTED_OUTPUT_KEY" >/dev/null \
     && echo "confirmed: object exists at the exact expected key ($EXPECTED_OUTPUT_KEY)" \
     || echo "MISSING at the exact expected key ($EXPECTED_OUTPUT_KEY) — do not proceed; list-objects below to see what actually landed"
   aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$OUTPUT_DEST"   # for comparison only
   ```

2. **Confirm the EventBridge pattern matched the real job's completion**, not a hand-written stand-in.
   Pull the actual event MediaConvert emitted from CloudWatch Logs (if you've wired a debug log
   target) or reuse the STEP 4 sample with `"jobId"` set to `$TEST_JOB_ID` — either way, re-run
   `aws events test-event-pattern` against that specific job's terminal status and confirm `true`.

3. **Confirm the API destination actually delivered a request**, not merely that it's attached.
   Check invocation metrics for the concrete window the test job completed in:
   ```bash
   aws cloudwatch get-metric-statistics --namespace AWS/Events \
     --metric-name Invocations --dimensions Name=RuleName,Value=gc-transcode-job-state \
     --start-time "$(date -u -v-15M +%Y-%m-%dT%H:%M:%S)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
     --period 300 --statistics Sum
   # expect Sum >= 1 for the window the test job completed in. Also check FailedInvocations is 0 —
   # a positive Invocations count with a matching FailedInvocations count means it fired and every
   # delivery was rejected (e.g. wrong header), which looks like nothing happened from the app side.
   ```
   Once `/api/transcode/callback` exists (a later task), the strongest version of this check is
   application-level: confirm a request actually reached the route (a 401 in the route's logs
   proves delivery even before the secret is wired correctly; a 200 proves the whole path).

4. **Confirm the produced proxy is NOT archive-tagged.** Masters are tagged
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

Record pass/fail against all four before treating this pipeline as live. **A rule, role, or
destination that shows green in its own console and has never moved a real object through the
whole path is unverified, not working.**
