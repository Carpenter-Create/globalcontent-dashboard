# Avatar storage (S3) setup — run once per environment

Dedicated **private** avatars bucket on the **existing GC AWS account** — the
same account as title assets (`gc-content-assets-dev` / `gc-content-assets-prod`).
This is **not** a prefix on the title-asset bucket. Title objects stay in
`S3_BUCKET` under `orgs/<org>/titles/...`. Faces never go there and are never
served through title CloudFront.

Do **not** apply this from CI. Founder-executed only. No SQL. No Supabase
Storage. No public URLs. No second AWS account.

Intended bucket names (same account, `us-east-1`):

| Environment | `S3_AVATARS_BUCKET` |
| --- | --- |
| Production | `gc-avatars-prod` |
| Dev / local / preview | `gc-avatars-dev` |

Object key (only legal prefix): `avatars/{user-id}/avatar`
Example: `avatars/11111111-1111-4111-8111-111111111111/avatar`

Prereqs: `aws` CLI authenticated to the GC AWS account; same region as title
assets (e.g. us-east-1).

    export AWS_REGION=us-east-1
    export AVATARS_BUCKET=gc-avatars-prod   # or gc-avatars-dev

1) Create the bucket + block all public access:

    aws s3api create-bucket --bucket "$AVATARS_BUCKET" --region "$AWS_REGION" \
      $( [ "$AWS_REGION" = us-east-1 ] || echo --create-bucket-configuration LocationConstraint=$AWS_REGION )
    aws s3api put-public-access-block --bucket "$AVATARS_BUCKET" \
      --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

Do not attach a public bucket policy. Do not enable a website. Do not add this
bucket as a CloudFront origin.

2) Least-privilege on the **existing** app IAM user (`gc-assets-app`) — same
credentials the title-asset path already uses. GetObject/PutObject on
`avatars/*` only. No DeleteObject (nothing is deleted; re-upload overwrites
the same key). Do not grant `/*` on this bucket. Do not grant this prefix on
`S3_BUCKET`.

    aws iam put-user-policy --user-name gc-assets-app --policy-name gc-avatars-s3 --policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["s3:GetObject","s3:PutObject"],
        "Resource": "arn:aws:s3:::'"$AVATARS_BUCKET"'/avatars/*"
      }]
    }'

The app PUTs server-side. Browser CORS on this bucket is not required.

3) Set env vars (server-only) locally (`.env.local`) and in Vercel (all
environments). Add the **name** to `.env.example` (agents cannot edit
`.env.*`):

    S3_AVATARS_BUCKET=gc-avatars-prod   # or gc-avatars-dev

Reuse existing `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
Never `NEXT_PUBLIC_`. Never point `S3_AVATARS_BUCKET` at `S3_BUCKET`.

Code: `src/lib/s3-avatars.ts` reads `S3_AVATARS_BUCKET` and refuses to run
when it equals `S3_BUCKET`. Display is a short-lived signed GET (5 minutes).
