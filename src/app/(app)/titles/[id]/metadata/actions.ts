"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { parseMetadata, computeMetadataFindings, METADATA_LOGIC_VERSION } from "@/lib/metadata";
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

  // §19: metadata changed → refresh this title's validator findings. Best-effort — the
  // save already committed, so a reconcile failure (incl. a transport rejection) must not
  // fail the save.
  try {
    const findings = computeMetadataFindings(parsed.data as Record<string, unknown>);
    await supabase.rpc("reconcile_title_findings", {
      p_org_id: orgId,
      p_title_id: titleId,
      p_findings: findings as unknown as Json,
      p_logic_version: METADATA_LOGIC_VERSION,
    });
  } catch (e) {
    console.error("[findings] reconcile after metadata save failed", e);
  }

  revalidatePath(`/titles/${titleId}`);
  revalidatePath(`/titles/${titleId}/metadata`);
  return {};
}
