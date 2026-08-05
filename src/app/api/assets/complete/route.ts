import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveOperableTitle } from "@/lib/assets";
import { completeMultipart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  kind: z.enum(["master", "caption", "poster", "banner", "screener"]),
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

  return NextResponse.json({ assetId });
}
