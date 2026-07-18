import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Download the immutable rendered agreement text (§5 "downloadable forever"). RLS on
// source_documents scopes this to the caller's orgs — they can only fetch their own.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: doc } = await supabase
    .from("source_documents")
    .select("raw")
    .eq("id", id)
    .eq("kind", "agreement")
    .maybeSingle();

  const raw = doc?.raw as unknown as { text?: string; terms_version?: string } | null;
  if (!raw?.text) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(raw.text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="global-content-agreement-${raw.terms_version ?? "v1"}.txt"`,
    },
  });
}
