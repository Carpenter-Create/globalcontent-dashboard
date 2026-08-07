import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveOperableTitle, assetKey, PART_SIZE } from "@/lib/assets";
import { createMultipart } from "@/lib/s3";

const Body = z.object({
  // .toLowerCase(): see the identical comment in ../complete/route.ts. This route mints the
  // master's S3 key from titleId (assetKey()) — normalizing here is what makes that key match
  // the canonical-lowercase titleId Postgres will later compare it against in
  // create_transcode_job's scope check.
  titleId: z.string().uuid().transform((v) => v.toLowerCase()),
  kind: z.enum(["master", "caption", "poster", "banner", "screener", "trailer"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(255).optional(),
  bytes: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { titleId, kind, filename, contentType } = parsed.data;

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, titleId, user.id);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const key = assetKey(op.orgId, titleId, kind, filename);
  let uploadId: string;
  try {
    // Only masters carry the archive tag. Artwork, captions, screeners and trailers stay
    // in the instant tiers — they are small and user-facing. A trailer in particular is
    // promotional and gets watched on demand; a 12-hour restore would make it useless.
    uploadId = await createMultipart(key, contentType, { archivable: kind === "master" });
  } catch (e) {
    console.error(`[assets:initiate] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not start upload. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ uploadId, key, partSize: PART_SIZE });
}
