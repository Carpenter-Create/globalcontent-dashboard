"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { parseMetadata } from "@/lib/metadata";
import type { Json } from "@/lib/supabase/database.types";

// Save (upsert) title metadata. Validates against the canonical zod schema
// (the validator decides) then writes via the set_title_metadata RPC.
export async function saveMetadata(
  orgId: string,
  titleId: string,
  values: unknown,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const parsed = parseMetadata(values);
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.rpc("set_title_metadata", {
    p_org_id: orgId,
    p_title_id: titleId,
    p_data: parsed.data as Json,
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${titleId}`);
  revalidatePath(`/titles/${titleId}/metadata`);
  return {};
}
