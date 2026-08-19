import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { isAskGlobeeTier, type AskGlobeeTier } from "@/lib/ask-globee";

// Live org tier from existing readable fields. No new SQL.
//
// 1. contract_terms.tier — current term (effective_to is null). RLS permits
//    account_owner, accountant, legal, and GC staff (view_financial / is_gc_staff).
//    viewer and delivery_ops are blocked (financial_access_test).
// 2. Fallback: latest contract_assents → source_documents.raw.tier, already read
//    on /account/agreements. source_documents_select uses 'view', so every member
//    can read the accepted-agreement tier.
//
// A missing or unreadable tier is null — callers treat that as the Access gate.
// A null is not invented as "access"; it is the absence of a pro/premium signal.

type AssentRaw = { raw?: { tier?: unknown } | null };

function assentTier(row: {
  source_documents?: AssentRaw | AssentRaw[] | null;
}): unknown {
  const docs = row.source_documents;
  const doc = Array.isArray(docs) ? docs[0] : docs;
  return doc?.raw?.tier;
}

export const getActiveOrgTier = cache(async (orgId: string): Promise<AskGlobeeTier | null> => {
  const supabase = await createClient();

  const { data: term } = await supabase
    .from("contract_terms")
    .select("tier")
    .eq("org_id", orgId)
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (isAskGlobeeTier(term?.tier)) return term.tier;

  const { data: assent } = await supabase
    .from("contract_assents")
    .select("source_documents(raw)")
    .eq("org_id", orgId)
    .order("agreed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromAssent = assent ? assentTier(assent) : null;
  return isAskGlobeeTier(fromAssent) ? fromAssent : null;
});
