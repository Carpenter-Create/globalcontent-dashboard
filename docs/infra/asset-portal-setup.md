# Asset portal (CloudFront + Resend) setup — run once per environment

Prereqs: `aws` CLI authenticated to the GC AWS account; the asset bucket from
`docs/infra/asset-storage-setup.md` already exists (`$BUCKET`); a GC-owned domain
managed in Route 53; a Resend account.

    export AWS_REGION=us-east-1
    export BUCKET=gc-content-assets-prod
    export PORTAL_SUBDOMAIN=links.globalcontent.example   # pick the real GC subdomain
    export HOSTED_ZONE_ID=ZXXXXXXXXXXXXX                  # Route 53 zone for the parent domain

CloudFront is a global service but its **ACM cert must be requested in us-east-1**,
regardless of which region the bucket lives in.

## 1) ACM cert for the portal subdomain (us-east-1)

    aws acm request-certificate --region us-east-1 \
      --domain-name "$PORTAL_SUBDOMAIN" \
      --validation-method DNS

Add the DNS validation CNAME ACM returns to Route 53 (`$HOSTED_ZONE_ID`), then wait for
`Status: ISSUED`:

    aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN"

## 2) Origin Access Control (OAC) — S3 stays private

Create an OAC and attach it to the distribution's origin. The bucket keeps
`BlockPublicAccess` fully on (from asset-storage-setup.md) — CloudFront reaches it only
via the OAC-signed origin request, never a public bucket policy or a legacy OAI.

    aws cloudfront create-origin-access-control --origin-access-control-config '{
      "Name": "gc-assets-oac",
      "SigningProtocol": "sigv4",
      "SigningBehavior": "always",
      "OriginAccessControlOriginType": "s3"
    }'

Capture the returned `Id` as `$OAC_ID`.

## 3) CloudFront distribution over the private bucket

Create the distribution with the S3 bucket (regional endpoint, not the website
endpoint) as origin, the OAC attached, viewer HTTPS-only, and the ACM cert +
subdomain as the alternate domain name (CNAME). Restrict viewer access to signed
URLs (`TrustedKeyGroups`, see step 4) — this is what makes every download require a
valid signature, not just a guessable path.

Key settings (console or `aws cloudfront create-distribution` with a full config
JSON — abbreviated here for the settings that matter):

- Origin: `$BUCKET.s3.$AWS_REGION.amazonaws.com`, OAC = `$OAC_ID`, no OAI.
- Alternate domain name (CNAME): `$PORTAL_SUBDOMAIN`.
- Viewer certificate: the ACM cert from step 1 (us-east-1), TLS 1.2+.
- Viewer protocol policy: `redirect-to-https`.
- Restrict viewer access: **Yes**, trusted key group = the one created in step 4.
- Default root object: none (every request is an explicit signed object key).

Update the bucket policy to allow only this distribution's OAC (CloudFront gives you
the exact policy snippet in the console after creating the origin; it scopes
`s3:GetObject` to `AWS:SourceArn = arn:aws:cloudfront::<account>:distribution/<dist-id>`).

Capture the distribution's domain name (`dxxxxxxxxxxxxx.cloudfront.net`) — this is
`CLOUDFRONT_DOMAIN` unless you're fronting it with the custom subdomain directly (see
step 5).

## 4) Signing key pair + key group

Generate an RSA key pair locally. **The private key never touches S3, Git, or the
app's source tree** — it goes straight into the env var / secret manager.

    openssl genrsa -out cloudfront-portal-private.pem 2048
    openssl rsa -pubout -in cloudfront-portal-private.pem -out cloudfront-portal-public.pem

Upload the public key to CloudFront and put it in a key group:

    aws cloudfront create-public-key --public-key-config '{
      "CallerReference": "gc-portal-'"$(date +%s)"'",
      "Name": "gc-portal-signing-key",
      "EncodedKey": "'"$(cat cloudfront-portal-public.pem)"'"
    }'
    # capture the returned public key Id as $PUBLIC_KEY_ID

    aws cloudfront create-key-group --key-group-config '{
      "Name": "gc-portal-key-group",
      "Items": ["'"$PUBLIC_KEY_ID"'"]
    }'
    # capture the returned key group Id and attach it as the distribution's TrustedKeyGroups

Capture the **key pair ID** (the public key's `Id`, same value used when signing) as
`CLOUDFRONT_KEY_PAIR_ID`. The contents of `cloudfront-portal-private.pem` become the
`CLOUDFRONT_PRIVATE_KEY` secret (PEM, including headers/footers, newlines preserved).
Delete the local `.pem` files once both are stored in the secret manager / Vercel —
don't leave a copy on disk.

## 5) Route 53 record

Point the subdomain at the distribution:

    aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
      --change-batch '{
        "Changes": [{
          "Action": "UPSERT",
          "ResourceRecordSet": {
            "Name": "'"$PORTAL_SUBDOMAIN"'",
            "Type": "A",
            "AliasTarget": {
              "HostedZoneId": "Z2FDTNDATAQYW2",
              "DNSName": "<distribution-domain-name>",
              "EvaluateTargetHealth": false
            }
          }
        }]
      }'

(`Z2FDTNDATAQYW2` is AWS's fixed CloudFront alias hosted-zone ID — same in every
account.) Once this resolves, `CLOUDFRONT_DOMAIN` is `https://$PORTAL_SUBDOMAIN`.

## 6) Resend account + sending domain

In the Resend dashboard: add the GC sending domain, add the returned DKIM/SPF/DMARC
DNS records to Route 53, wait for domain status `Verified`. Create an API key
scoped to sending only.

`PORTAL_EMAIL_FROM` is an address on the verified domain (e.g.
`links@notifications.globalcontent.example`) — must match the verified domain
exactly or Resend will reject the send.

## 7) Env vars (server-only — none `NEXT_PUBLIC_`)

Set in `.env.local` (dev) and in Vercel (all environments the portal runs in):

| Var | Purpose |
|---|---|
| `CLOUDFRONT_DOMAIN` | Base URL the app builds signed download URLs against (custom subdomain or `*.cloudfront.net`). |
| `CLOUDFRONT_KEY_PAIR_ID` | Public key ID CloudFront uses to verify the URL signature. |
| `CLOUDFRONT_PRIVATE_KEY` | PEM private key used to sign download URLs server-side; pairs with `CLOUDFRONT_KEY_PAIR_ID`; never committed. |
| `RESEND_API_KEY` | Auth for sending the OTP email via Resend. |
| `PORTAL_EMAIL_FROM` | Verified-domain sender address for portal OTP emails. |
| `PORTAL_BASE_URL` | Base URL (this app's own origin) used to build the `/portal/[token]` link GC staff copy and send. |

All six are read server-side only (route handlers / server actions) — never passed to
the client bundle, never prefixed `NEXT_PUBLIC_`. Confirmed by the `/leak-check` pass
for this slice.

## Manual end-to-end test (run after CloudFront + Resend are provisioned)

This cannot be exercised until the infra above exists in a real AWS account and
Resend account — it is **not** run as part of automated verification.

1. As GC, open `/gc/deliveries`, pick a delivery whose title has a master asset,
   click **Generate link**, copy the URL.
2. In a logged-out browser (or incognito), open the URL → enter name/company/email
   → receive the one-time code via Resend → verify the code → click **Download** →
   confirm the file downloads via a signed `$CLOUDFRONT_DOMAIN` URL (inspect the
   request: query string carries `Key-Pair-Id`, `Signature`, `Expires`).
3. Back in `/gc/deliveries`, confirm the access-event list shows, in order:
   `room_viewed`, `otp_sent`, `otp_verified`, `download`.
4. Click **Revoke** on the link → reopening the same URL shows the expired-link
   card; a direct `POST /api/portal/download` for that link returns `403`.

Negatives:

5. Expired OTP: wait for the OTP to pass its expiry (or set `expires_at` back in the
   `portal_otps` row for a test session) → verify rejects with the expired-code
   error, no session is created.
6. Attempt cap: submit 6 wrong codes in a row → the 6th (or later) request returns
   `429`, and the row's attempt counter reflects the cap having been hit.

Record the result of this checklist in `docs/known-divergences.md` (or the sign-off
thread) once run — it is the one step in this slice that automated tests cannot
cover, since it depends on real CloudFront signing and a real Resend send.

---

## Screener room (Portal-2)

The screener room reuses **the same infrastructure as the master download** — no
new AWS or Resend provisioning. The screener streams from S3 via the same
CloudFront distribution + signing key pair, and the OTP email uses the same Resend
sender. Differences from the master-download path:

- **Screeners stay on S3 Standard — never Glaciered.** Only masters have the 90-day
  Glacier lifecycle. A dedicated screener is always immediately streamable. (If a
  title's `screener_source = master` and that master is already in Glacier, the
  player shows the same "preparing" state as the download; the restore itself is
  Portal-3.)
- **View, not download.** The player streams the signed URL inline (range requests);
  `controlsList="nodownload"`. View-only is best-effort — there is **no DRM**
  (leak-proofing is a separate, deferred vendor decision), so the signed URL is, in
  principle, capturable. Acceptable for pitch-stage screeners.
- **No rights/grant gate on the pitch view** (Rule 12 governs distribution, not
  pitching) — the only gate is OTP identity.

Env vars: **unchanged** (the six from the table above). `PORTAL_BASE_URL` is reused
to build screener-link URLs on `/gc/review`.

### Manual end-to-end test (run after the Portal-1 provisioning is in place)

1. As a client, on a title's detail page set **Screener source** to *dedicated* and
   upload a **Screener** asset (or leave it *master* to screen the master).
2. As GC, on `/gc/review` for that title, click **Generate screener link** → copy
   the `$PORTAL_BASE_URL/portal/<token>` URL.
3. In a logged-out browser, open the URL → enter name/company/email → receive the
   code via Resend → verify → the **screener plays** (streamed inline via a signed
   `$CLOUDFRONT_DOMAIN` URL — it should not download).
4. Scrub, pause, and finish the video. Back on `/gc/review`, confirm the per-viewer
   summary shows that viewer's **% watched**, **completed**, **replays**, and
   **last-viewed**.
5. Click **Revoke** on the screener link → reopening the URL shows the expired-link
   card; `POST /api/portal/screener` for that session returns `403`.

Record the result alongside the Portal-1 checklist — this depends on real CloudFront
signing and a real Resend send, which automated tests cannot cover.
