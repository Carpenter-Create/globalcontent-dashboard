import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveOperableTitle } from "@/lib/assets";
import { signUploadPart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), checksumSHA256: z.string().min(1) }))
    .min(1)
    .max(1000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { titleId, key, uploadId, parts } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, titleId);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  // Bind the key to the caller's org — never sign a key outside their namespace.
  if (!key.startsWith(`orgs/${op.orgId}/titles/${titleId}/`))
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  const urls = await Promise.all(
    parts.map(async (p) => ({
      partNumber: p.partNumber,
      url: await signUploadPart(key, uploadId, p.partNumber, p.checksumSHA256),
    })),
  );
  return NextResponse.json({ urls });
}
