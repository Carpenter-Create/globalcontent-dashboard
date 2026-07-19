"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Decision = Database["public"]["Enums"]["review_decision"];

// GC decision. Gated at the DB by review_title (is_gc_staff); the (gc) layout
// already blocks non-GC users from reaching this surface.
export async function reviewTitle(
  titleId: string,
  decision: Decision,
  reason: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (decision === "reject" && !reason.trim()) return { error: "A reason is required to reject." };

  const { error } = await supabase.rpc("review_title", {
    p_title_id: titleId,
    p_decision: decision,
    p_reason: reason.trim(), // RPC nullif('' , '') stores null; approve ignores it
  });
  if (error) return { error: error.message };

  revalidatePath("/gc/review");
  return {};
}
