# Portal go-live provisioning — paste-able CLI runbook

## Context
All six portal/findings/notifications slices are merged to `main` and green. Nothing code-blocks launch —
what remains is **provisioning** (AWS CloudFront + S3 lifecycle + IAM, Resend, Vercel env + WAF) and the
manual end-to-end tests. This runbook is the ordered, paste-able CLI version with a fill-in table so you
can run it top-to-bottom. Companion: `asset-portal-setup.md` (reference) and `portal-go-live-checklist.md`
(the what/why index).

**Prereqs:** `aws` CLI authenticated to the GC AWS account (`aws sts get-caller-identity` returns the GC
account), plus `openssl`, `jq`, and the `vercel` CLI (`npm i -g vercel && vercel link`). Resend account created.
Nothing here deletes data — it creates new resources and sets env vars.

---

## STEP 0 — Fill these in, then paste this block into your shell
Replace every `<...>`. Everything below reuses these.

```bash
export AWS_REGION=us-east-1                        # keep us-east-1 (ACM for CloudFront MUST be us-east-1)
export BUCKET=<your real assets bucket>           # e.g. gc-content-assets-prod (from asset-storage-setup)
export APEX=<your GC domain>                       # e.g. globalcontent.tv
export PORTAL_SUBDOMAIN=links.$APEX               # the branded asset-download host
export APP_ORIGIN=https://<your app origin>        # this app's own URL, e.g. https://app.$APEX (for PORTAL_BASE_URL)
export SENDER=links@notifications.$APEX            # OTP "from" address (on a domain you'll verify in Resend)
export HOSTED_ZONE_ID=<Route53 hosted zone id for $APEX>   # aws route53 list-hosted-zones
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "acct=$ACCOUNT_ID bucket=$BUCKET subdomain=$PORTAL_SUBDOMAIN origin=$APP_ORIGIN"
```
Known-good constants (already correct, do not change): IAM user `gc-assets-app`, inline policy `gc-assets-s3`,
CloudFront alias hosted-zone `Z2FDTNDATAQYW2`.

---

## STEP 1 — S3 lifecycle: masters → Glacier Flexible at 90 days
```bash
cat > /tmp/lifecycle.json <<JSON
{ "Rules": [ {
  "ID": "masters-to-glacier-90d",
  "Status": "Enabled",
  "Filter": { "Prefix": "master/" },
  "Transitions": [ { "Days": 90, "StorageClass": "GLACIER" } ]
} ] }
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///tmp/lifecycle.json
# verify:
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
```
> The S3 key scheme is `orgs/<org>/titles/<title>/<kind>/...`, so the `master/` prefix must match how keys are
> laid out. **Verify the real prefix** with `aws s3 ls s3://$BUCKET/ --recursive | head` and adjust the
> `Prefix` if masters aren't top-level `master/` (an object-tag filter is the robust alternative). This is the
> one value that couldn't be confirmed from the repo.

## STEP 2 — IAM: add `s3:RestoreObject` (keep everything else; still no Delete)
```bash
cat > /tmp/gc-assets-s3.json <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow",
  "Action": ["s3:PutObject","s3:GetObject","s3:ListMultipartUploadParts","s3:AbortMultipartUpload","s3:RestoreObject"],
  "Resource": "arn:aws:s3:::$BUCKET/*"
} ] }
JSON
aws iam put-user-policy --user-name gc-assets-app --policy-name gc-assets-s3 --policy-document file:///tmp/gc-assets-s3.json
aws iam get-user-policy --user-name gc-assets-app --policy-name gc-assets-s3   # verify RestoreObject present, no DeleteObject
```

## STEP 3 — ACM certificate for the portal subdomain (us-east-1)
```bash
export CERT_ARN=$(aws acm request-certificate --region us-east-1 \
  --domain-name "$PORTAL_SUBDOMAIN" --validation-method DNS \
  --query CertificateArn --output text)
# get the DNS validation CNAME:
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
# create that CNAME in Route 53 (paste Name/Value from the previous output):
cat > /tmp/acm-validate.json <<JSON
{ "Changes": [ { "Action": "UPSERT", "ResourceRecordSet": {
  "Name": "<validation Name>", "Type": "CNAME", "TTL": 300,
  "ResourceRecords": [ { "Value": "<validation Value>" } ] } } ] }
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file:///tmp/acm-validate.json
# wait until ISSUED (re-run until Status=ISSUED, ~a few minutes):
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" --query 'Certificate.Status'
```

## STEP 4 — Origin Access Control (S3 stays private)
```bash
export OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
  '{"Name":"gc-assets-oac","SigningProtocol":"sigv4","SigningBehavior":"always","OriginAccessControlOriginType":"s3"}' \
  --query 'OriginAccessControl.Id' --output text)
echo "OAC_ID=$OAC_ID"
```

## STEP 5 — Signing key pair + public key + key group (needed before the distribution)
```bash
openssl genrsa -out /tmp/cf-portal-private.pem 2048
openssl rsa -pubout -in /tmp/cf-portal-private.pem -out /tmp/cf-portal-public.pem
export PUBLIC_KEY_ID=$(aws cloudfront create-public-key --public-key-config \
  "{\"CallerReference\":\"gc-portal-$(date +%s)\",\"Name\":\"gc-portal-signing-key\",\"EncodedKey\":\"$(cat /tmp/cf-portal-public.pem)\"}" \
  --query 'PublicKey.Id' --output text)
export KEY_GROUP_ID=$(aws cloudfront create-key-group --key-group-config \
  "{\"Name\":\"gc-portal-key-group\",\"Items\":[\"$PUBLIC_KEY_ID\"]}" \
  --query 'KeyGroup.Id' --output text)
echo "PUBLIC_KEY_ID=$PUBLIC_KEY_ID  KEY_GROUP_ID=$KEY_GROUP_ID"
# -> PUBLIC_KEY_ID is your CLOUDFRONT_KEY_PAIR_ID; the private PEM is your CLOUDFRONT_PRIVATE_KEY (step 10)
```

## STEP 6 — CloudFront distribution (private origin, signed, TLS, your subdomain)
```bash
cat > /tmp/dist.json <<JSON
{ "CallerReference": "gc-portal-$(date +%s)", "Comment": "GC asset portal",
  "Enabled": true, "Aliases": { "Quantity": 1, "Items": ["$PORTAL_SUBDOMAIN"] },
  "Origins": { "Quantity": 1, "Items": [ {
    "Id": "s3-$BUCKET", "DomainName": "$BUCKET.s3.$AWS_REGION.amazonaws.com",
    "OriginAccessControlId": "$OAC_ID", "S3OriginConfig": { "OriginAccessIdentity": "" } } ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-$BUCKET", "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedKeyGroups": { "Enabled": true, "Quantity": 1, "Items": ["$KEY_GROUP_ID"] },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
  "ViewerCertificate": { "ACMCertificateArn": "$CERT_ARN", "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021" } }
JSON
export DIST_JSON=$(aws cloudfront create-distribution --distribution-config file:///tmp/dist.json)
export DIST_ID=$(echo "$DIST_JSON" | jq -r '.Distribution.Id')
export DIST_DOMAIN=$(echo "$DIST_JSON" | jq -r '.Distribution.DomainName')
echo "DIST_ID=$DIST_ID  DIST_DOMAIN=$DIST_DOMAIN"
```
(`658327ea-...` is AWS's managed **CachingOptimized** policy id — same in every account.)

## STEP 7 — Bucket policy: let ONLY this distribution read the bucket
```bash
cat > /tmp/bucket-policy.json <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Sid": "AllowCloudFrontOAC", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject", "Resource": "arn:aws:s3:::$BUCKET/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DIST_ID" } } } ] }
JSON
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/bucket-policy.json
```
> Note: this **replaces** the bucket policy. If the bucket already has a policy (e.g. a TLS-only deny),
> merge that statement into the JSON above rather than overwriting it — check first with
> `aws s3api get-bucket-policy --bucket "$BUCKET"`.

## STEP 8 — Route 53: point the subdomain at the distribution
```bash
cat > /tmp/portal-dns.json <<JSON
{ "Changes": [ { "Action": "UPSERT", "ResourceRecordSet": {
  "Name": "$PORTAL_SUBDOMAIN", "Type": "A",
  "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } } ] }
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file:///tmp/portal-dns.json
# verify (after DNS propagates, minutes):
curl -sI "https://$PORTAL_SUBDOMAIN/" | head -1   # expect an HTTP response from CloudFront (403 for an unsigned path is fine)
export CLOUDFRONT_DOMAIN="https://$PORTAL_SUBDOMAIN"
```

## STEP 9 — Resend (domain verify is console; DNS via CLI) + API key
Resend has no CLI, so:
1. Resend dashboard → **Domains → Add** the sending domain (e.g. `notifications.$APEX`). It shows DKIM/SPF (and DMARC) records.
2. Add those records in Route 53 (`aws route53 change-resource-record-sets ...`, one UPSERT per record), wait until Resend shows **Verified**.
3. Resend dashboard → **API Keys → Create** a send-only key → copy it (that's `RESEND_API_KEY`).

## STEP 10 — Set the 6 env vars (Vercel + local)
The private key is multiline — write it to Vercel from the file to preserve newlines:
```bash
printf '%s' "$CLOUDFRONT_DOMAIN"      | vercel env add CLOUDFRONT_DOMAIN production
printf '%s' "$PUBLIC_KEY_ID"          | vercel env add CLOUDFRONT_KEY_PAIR_ID production
vercel env add CLOUDFRONT_PRIVATE_KEY production < /tmp/cf-portal-private.pem
printf '%s' "<RESEND_API_KEY>"        | vercel env add RESEND_API_KEY production
printf '%s' "$SENDER"                 | vercel env add PORTAL_EMAIL_FROM production
printf '%s' "$APP_ORIGIN"             | vercel env add PORTAL_BASE_URL production
# repeat each for `preview` if you want the portal working in preview deploys.
vercel env ls | grep -Ei 'cloudfront|resend|portal_'   # verify all six, none NEXT_PUBLIC_
# mirror the same 6 into your local .env.local for local testing, then:
vercel --prod        # redeploy so the new env takes effect
```
Then **securely delete** the local PEM: `rm /tmp/cf-portal-private.pem` (it's now in Vercel + your .env.local only).

## STEP 11 — Vercel WAF rate-limit on /api/portal/* (launch gate)
Vercel Firewall is dashboard-managed: Vercel project → **Firewall** → **Add Rule** → **Rate Limit** →
path `/api/portal/*` (or specifically `/api/portal/request-otp`), a sane per-IP limit (e.g. 20 req / 10 min),
action **Deny/Challenge**. Enable it. **Do not send real recipients to the portal until this rule + a verified
Resend domain are both live.**

---

## Verification / end-to-end (do all after 1–11; record pass/fail)
1. **Master download:** GC generates a link on `/gc/deliveries` → logged-out browser → name/company/email →
   Turnstile → emailed code → **Download** → file downloads via a `$PORTAL_SUBDOMAIN` (signed) URL. Revoke → 403.
   Negatives: expired OTP rejected; >5 codes/(link,email) or >20/link in an hour → 429.
2. **Screener room:** set a title's screener source (master or dedicated upload) → GC screener link on
   `/gc/review` → identity → code → the screener **plays** (streamed, not downloaded) → per-viewer summary shows.
3. **Glacier restore:** force a master to Glacier (S3 console, or wait 90 days) → open its link → "preparing
   (~3–5h)" + a `restore_requested` event → after restore, same link serves it → 2nd access during the window
   launches no new retrieval.
4. **Notifications:** reject a title → client `/messages` shows it (+ reason) + nav unread badge; advance a
   delivery → a "delivery update" message appears.

## After go-live (optional code follow-ons, when you want them)
- **Email channel for notifications** (Resend now on `main`): wire `create_notification` to also send email.
- **Health score**: aggregate of findings, once you finalize the canonical metadata field list (§21.1).
