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

// GC attaches the vendor once a buyer's deal closes (attach_link_vendor, 20260806000400).
// vendors is a GC-only roster, so a client can never do this themselves — a buyer's screener
// link sits with vendor_id null until GC sets it, and the master stays unreachable through
// that link until then (master-download re-resolves licensing from THIS link's vendor_id).
// `force` reassigns a link that already carries a DIFFERENT vendor; omitted, the RPC blocks
// that rather than silently moving the buyer's master access to another company.
export async function attachLinkVendor(input: {
  titleId: string;
  linkId: string;
  vendorId: string;
  force?: boolean;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("attach_link_vendor", {
    p_link_id: input.linkId,
    p_vendor_id: input.vendorId,
    // undefined (not false) so an un-forced call takes the RPC's own `default null` ->
    // coalesce(...,false) path rather than us re-deciding what "not forcing" means here.
    p_force: input.force ? true : undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/gc/titles/${input.titleId}`);
  return {};
}
