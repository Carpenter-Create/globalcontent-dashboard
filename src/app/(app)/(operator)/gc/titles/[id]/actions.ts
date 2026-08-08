"use server";

import { revalidatePath } from "next/cache";

import { submitProxyJob } from "@/lib/mediaconvert";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  TRANSCODE_RETRY_CONFLICT,
  TRANSCODE_RETRY_INELIGIBLE,
  TRANSCODE_RETRY_NOT_AUTHORIZED,
  TRANSCODE_RETRY_RECORD_FAILED,
  TRANSCODE_RETRY_SUBMIT_FAILED,
  TRANSCODE_RETRY_UNAUTHENTICATED,
  isTranscodeJobRetryable,
  isTranscodeJobUniqueConflict,
  type TranscodeStatus,
} from "@/lib/transcode-jobs";

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
// 20260806000400, default-null'd for p_vendor_id in 20260807000200). vendors is a GC-only
// roster, so a client can never do this themselves — a buyer's link sits with vendor_id null
// until GC sets it, and the master stays unreachable through that link until then
// (master-download re-resolves licensing from THIS link's vendor_id). `vendorId: null` here at
// the call-site boundary means detach — the only way to undo a mis-attach without writing a
// false fact via a forced reassignment; see the RPC call below for how that becomes `undefined`
// on the wire. `force` confirms a reassignment to a DIFFERENT vendor, or a first attach to a
// vendor that already has an active grant+delivery for this title (that pair would release the
// master immediately) — omitted, the RPC blocks both.
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
    // p_vendor_id now has `default null` (20260807000200) instead of being a nullable-but-
    // required argument — a shape the Supabase type generator cannot express at all, which is
    // why an earlier version of this file hand-edited generated types to fake it and a
    // regeneration would have silently broken this call. Detach means OMITTING the argument:
    // `undefined` drops the key from the RPC payload, PostgREST leaves it unset, and Postgres
    // applies the SQL default (NULL) server-side — landing in the RPC's own
    // `if p_vendor_id is null then ... -- DETACH` branch exactly as before. Coalescing
    // `null` to `undefined` here IS the detach signal, not a "no value provided" no-op — do not
    // "simplify" this to `input.vendorId` as-is; that reintroduces the `string | null` shape the
    // generator refuses to produce.
    p_vendor_id: input.vendorId ?? undefined,
    // undefined (not false) so an un-forced call takes the RPC's own `default null` ->
    // coalesce(...,false) path rather than us re-deciding what "not forcing" means here.
    p_force: input.force ? true : undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/gc/titles/${input.titleId}`);
  return {};
}

/**
 * Task 6B — retry a failed / submit_failed screener-proxy job.
 *
 * Sequence matches the master-upload path: submit to MediaConvert, then record a NEW
 * `transcode_jobs` row via `create_transcode_job`. The old row is never updated or
 * deleted. Org / title / source asset / master key come from the server-read job row
 * (and its source asset), never from client-supplied keys. Output key is derived by
 * `submitProxyJob` → `proxyOutputKey` on that master key.
 *
 * Auth order:
 * 1. `getAuthUser()` — session
 * 2. `gc_can(operate)` — pre-side-effect safety gate (before any job/asset read / AWS)
 * 3. `create_transcode_job` → `member_can(..., 'operate')` — database write boundary
 *
 * Eligibility is re-checked server-side — never trust the button.
 */
export async function retryTranscodeJob(input: {
  titleId: string;
  jobId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: TRANSCODE_RETRY_UNAUTHENTICATED };

  // Pre-AWS operate gate. Fail closed on lookup error or non-true. Does not replace the RPC.
  const { data: canOperate, error: canOperateError } = await supabase.rpc("gc_can", {
    p_uid: user.id,
    p_capability: "operate",
  });
  if (canOperateError || canOperate !== true) {
    return { error: TRANSCODE_RETRY_NOT_AUTHORIZED };
  }

  const { data: job, error: jobReadError } = await supabase
    .from("transcode_jobs")
    .select("id, org_id, title_id, source_asset_id, status")
    .eq("id", input.jobId)
    .eq("title_id", input.titleId)
    .maybeSingle();

  if (jobReadError || !job) {
    return { error: TRANSCODE_RETRY_INELIGIBLE };
  }

  if (!isTranscodeJobRetryable(job.status as TranscodeStatus)) {
    return { error: TRANSCODE_RETRY_INELIGIBLE };
  }

  const { data: sourceAsset, error: assetReadError } = await supabase
    .from("assets")
    .select("id, storage_key, kind, org_id, title_id")
    .eq("id", job.source_asset_id)
    .maybeSingle();

  if (
    assetReadError ||
    !sourceAsset ||
    sourceAsset.kind !== "master" ||
    !sourceAsset.storage_key ||
    sourceAsset.org_id !== job.org_id ||
    sourceAsset.title_id !== job.title_id
  ) {
    return { error: TRANSCODE_RETRY_INELIGIBLE };
  }

  let externalJobId: string;
  let expectedKey: string;
  try {
    ({ externalJobId, expectedKey } = await submitProxyJob({
      masterKey: sourceAsset.storage_key,
    }));
  } catch {
    return { error: TRANSCODE_RETRY_SUBMIT_FAILED };
  }

  // AWS already accepted the job. A record failure/rejection is split-brain — return the
  // approved message; never throw through to the client; do not claim success.
  // No compensation / cleanup (matches upload path; concurrent-retry residual accepted).
  let recordError: { code?: string; message?: string; details?: string; hint?: string } | null =
    null;
  try {
    const recorded = await supabase.rpc("create_transcode_job", {
      p_org_id: job.org_id,
      p_title_id: job.title_id,
      p_source_asset_id: job.source_asset_id,
      p_expected_output_key: expectedKey,
      p_external_job_id: externalJobId,
    });
    recordError = recorded.error;
  } catch {
    return { error: TRANSCODE_RETRY_RECORD_FAILED };
  }

  if (recordError) {
    if (isTranscodeJobUniqueConflict(recordError)) {
      return { error: TRANSCODE_RETRY_CONFLICT };
    }
    const message = recordError.message?.trim() ?? "";
    // Only positively identified auth failures use authorization copy.
    if (/^not authorized\.?$/i.test(message) || /^not authenticated\.?$/i.test(message)) {
      return { error: message.endsWith(".") ? message : `${message}.` };
    }
    // Empty / unknown / unrelated uniqueness → split-brain warning after AWS accept.
    return { error: TRANSCODE_RETRY_RECORD_FAILED };
  }

  revalidatePath(`/gc/titles/${input.titleId}`);
  return {};
}
