import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveOperableTitle, assetKey, PART_SIZE } from "@/lib/assets";
import { createMultipart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  kind: z.enum(["master", "caption", "poster", "banner", "screener"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(255).optional(),
  bytes: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { titleId, kind, filename, contentType } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, titleId, user.id);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const key = assetKey(op.orgId, titleId, kind, filename);
  let uploadId: string;
  try {
    uploadId = await createMultipart(key, contentType);
  } catch (e) {
    console.error(`[assets:initiate] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not start upload. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ uploadId, key, partSize: PART_SIZE });
}
