"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// GC sets a title's forward-looking release date (go-to-market). Written via the
// set_release_date RPC, gated on is_gc_staff in the DB — there is no client write
// path for release_date. Passing null clears it.
export async function setReleaseDate(input: {
  titleId: string;
  date: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("set_release_date", {
    p_title_id: input.titleId,
    // undefined → RPC default null → clears the date.
    p_date: input.date ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/gc/titles/${input.titleId}`);
  return {};
}
