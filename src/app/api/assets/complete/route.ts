import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveOperableTitle } from "@/lib/assets";
import { completeMultipart } from "@/lib/s3";
import { submitProxyJob } from "@/lib/mediaconvert";

const Body = z.object({
  // .toLowerCase(): z.string().uuid() only validates the SHAPE, not the case — an uppercase
  // UUID (RFC 4122 permits either) would flow into the S3 key verbatim while Postgres always
  // renders p_title_id::text canonically lowercase. The LIKE scope-check in
  // create_transcode_job would then miss on a case mismatch alone, raise 'out of scope', and
  // (per Task 4's deliberate error-swallowing) silently leave that master without a proxy
  // forever. Normalizing here, before titleId reaches assetKey() or any RPC, keeps every
  // downstream comparison byte-for-byte consistent with Postgres's own canonical form.
  titleId: z.string().uuid().transform((v) => v.toLowerCase()),
  kind: z.enum(["master", "caption", "poster", "banner", "screener", "trailer"]),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1),
  bytes: z.number().int().nonnegative(),
  filename: z.string().max(255).optional(),
  contentType: z.string().max(255).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, b.titleId, user.id);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!b.key.startsWith(`orgs/${op.orgId}/titles/${b.titleId}/`))
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  let contentHash: string;
  try {
    contentHash = await completeMultipart(
      b.key,
      b.uploadId,
      b.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    );
  } catch (e) {
    console.error(`[assets:complete] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not finalize upload. Please try again." }, { status: 502 });
  }

  const { data: assetId, error } = await supabase.rpc("create_asset", {
    p_org_id: op.orgId,
    p_title_id: b.titleId,
    p_kind: b.kind,
    p_storage_key: b.key,
    p_content_hash: contentHash,
    p_bytes: b.bytes,
    p_content_type: b.contentType ?? undefined,
    p_original_filename: b.filename ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Best-effort. The master is already in S3 and the asset row is written above — a
  // transcode failure (MediaConvert unreachable, a submit-time throw, or the RPC raising,
  // including a 23505 unique-violation if an earlier job for this exact source already
  // completed) must NEVER lose the client's upload. A missing proxy just degrades the buyer
  // page to exactly what it does today: no regression, only a missing improvement. Submit
  // BEFORE recording — if the submit throws there is no job to record; if the record throws,
  // a job now exists in AWS with nothing tracking it here, which the scheduled poll (Task 5,
  // src/app/api/cron/transcode-poll) is designed to find and pick back up.
  if (b.kind === "master" && assetId) {
    try {
      const { externalJobId, expectedKey } = await submitProxyJob({ masterKey: b.key });
      const { error: jobError } = await supabase.rpc("create_transcode_job", {
        p_org_id: op.orgId,
        p_title_id: b.titleId,
        p_source_asset_id: assetId,
        p_expected_output_key: expectedKey,
        p_external_job_id: externalJobId,
      });
      if (jobError) console.error(`[transcode:record] ${jobError.message}`);
    } catch (e) {
      console.error(`[transcode:submit] ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ assetId });
}
