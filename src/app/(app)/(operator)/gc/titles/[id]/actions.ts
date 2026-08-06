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

// GC attaches (or detaches) the vendor on a buyer's screener link (attach_link_vendor,
// 20260806000400). vendors is a GC-only roster, so a client can never do this themselves — a
// buyer's link sits with vendor_id null until GC sets it, and the master stays unreachable
// through that link until then (master-download re-resolves licensing from THIS link's
// vendor_id). `vendorId: null` detaches — the only way to undo a mis-attach without writing a
// false fact via a forced reassignment. `force` confirms a reassignment to a DIFFERENT vendor,
// or a first attach to a vendor that already has an active grant+delivery for this title (that
// pair would release the master immediately) — omitted, the RPC blocks both.
export async function attachLinkVendor(input: {
  titleId: string;
  linkId: string;
  vendorId: string | null;
  force?: boolean;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("attach_link_vendor", {
    p_link_id: input.linkId,
    // Explicit null (detach) is a real, required value here — never coalesced to undefined,
    // which would omit the key and hit the RPC's own `default null` in a way that reads as
    // "not forcing" rather than "detach". Only `force` has an omit-vs-false distinction.
    p_vendor_id: input.vendorId,
    // undefined (not false) so an un-forced call takes the RPC's own `default null` ->
    // coalesce(...,false) path rather than us re-deciding what "not forcing" means here.
    p_force: input.force ? true : undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/gc/titles/${input.titleId}`);
  return {};
}
