#!/usr/bin/env node
/**
 * L7 — can the chain-of-title review gate be bypassed?
 *
 * Two separate questions, tested separately, because they have different answers:
 *
 *   Q1. Can a title reach `in_delivery` without passing `review_title`?
 *       (Is the STATUS TRANSITION gated?)
 *   Q2. Is `in_delivery` actually required before a title can be delivered —
 *       given a delivery record, a vendor export, a screener link, or a
 *       master-download link?
 *       (Is the GATE LOAD-BEARING downstream?)
 *
 * Static enumeration (see the report) says only `submit_title` and `review_title`
 * ever write `titles.status`. This script exercises the second question against a
 * live database with a real `gc_staff` JWT, because that is the one the static read
 * suggests is unenforced.
 *
 * Usage (local Supabase must be running):
 *   node scripts/security/l7-chain-of-title-gate.mjs
 *
 * Creates its own fixtures. Mutates nothing pre-existing. Never truncates or drops.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const PW = "Passw0rd!-" + run;

const results = [];
function record(id, what, verdict, detail) {
  results.push({ id, what, verdict, detail });
  const mark = { GATED: " GATED ", UNGATED: "UNGATED", SKIPPED: "SKIPPED", INFO: "  ..   " }[verdict];
  console.log(`[${mark}] ${id.padEnd(5)} ${what}\n         → ${detail}`);
}

async function mkUser(label) {
  const email = `l7-${run}-${label}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await c.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  return { id: data.user.id, email, client: c };
}

const GOOD_META = {
  synopsis: "A film.", runtime_minutes: "96", release_year: "2024",
  genre: "Drama", primary_language: "en", country_of_origin: "US",
};

async function main() {
  console.log(`\nL7 chain-of-title gate — run ${run}\ntarget: ${URL}\n--- seeding ---`);

  const { data: vendor, error: vErr } = await admin.from("vendors").insert({
    name: `L7-Vendor-${run}`, delivery_mode: "email", email_to: ["ops@vendor.test"],
    email_cc: [], active: true,
  }).select("id").single();
  if (vErr) throw new Error(`seed vendor: ${vErr.message}`);

  const owner = await mkUser("owner");
  const gc = await mkUser("gc");
  const { error: gcErr } = await admin.from("gc_staff").insert({ user_id: gc.id, role: "gc_delivery_ops" });
  if (gcErr) throw new Error(`seed gc_staff: ${gcErr.message}`);

  const c = owner.client, g = gc.client;
  const { data: orgId } = await c.rpc("create_org_and_membership", { p_name: `L7-Org-${run}` });
  const text = `AGREEMENT L7 ${run}`;
  await c.rpc("accept_terms", {
    p_tier: "access", p_terms_version: "v1-test",
    p_content_hash: createHash("sha256").update(text).digest("hex"), p_rendered_text: text,
  });

  // A title that has NEVER been submitted and NEVER been reviewed. Fully equipped
  // otherwise: complete metadata, an active world SVOD grant, and a master asset —
  // so nothing downstream can fail for a reason other than the missing review.
  const { data: titleId, error: tErr } = await c.rpc("create_title", {
    p_org_id: orgId, p_title: `L7 Never-Reviewed ${run}`, p_release_type: "new_release",
  });
  if (tErr) throw new Error(`create_title: ${tErr.message}`);
  await c.rpc("set_title_metadata", { p_org_id: orgId, p_title_id: titleId, p_data: GOOD_META });
  const { data: grantIds } = await c.rpc("add_rights_grant", {
    p_org_id: orgId, p_title_id: titleId, p_rights_types: ["svod"],
    p_mode: "world", p_territories: [], p_exclusive: false,
  });
  const grantId = Array.isArray(grantIds) ? grantIds[0] : grantIds;
  const { data: assetId } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: titleId, p_kind: "master",
    p_storage_key: `orgs/${orgId}/titles/${titleId}/master/${randomUUID()}/unreviewed.mov`,
    p_content_hash: createHash("sha256").update("l7").digest("hex"), p_bytes: 1234,
  });

  const status = async () => (await admin.from("titles").select("status").eq("id", titleId).single()).data.status;
  console.log(`org ${orgId}\ntitle ${titleId} status=${await status()}  grant ${grantId}  asset ${assetId}\n`);

  // ==========================================================================
  console.log("--- Q1. can the title reach in_delivery WITHOUT review_title? ---");

  // Q1a — client tries to set status directly (PostgREST).
  {
    const r = await c.from("titles").update({ status: "in_delivery" }).eq("id", titleId).select();
    const s = await status();
    record("Q1a", "client UPDATE titles SET status='in_delivery'",
      s === "draft" ? "GATED" : "UNGATED",
      s === "draft"
        ? `blocked: ${r.error?.code ?? "0 rows affected"}; status still '${s}'`
        : `*** status is now '${s}' ***`);
  }
  // Q1b — GC staff tries to set status directly (PostgREST).
  {
    const r = await g.from("titles").update({ status: "in_delivery" }).eq("id", titleId).select();
    const s = await status();
    record("Q1b", "gc_staff UPDATE titles SET status='in_delivery'",
      s === "draft" ? "GATED" : "UNGATED",
      s === "draft"
        ? `blocked: ${r.error?.code ?? "0 rows affected"}; status still '${s}'`
        : `*** status is now '${s}' ***`);
  }
  // Q1c — review_title on a title that was never submitted (still draft).
  {
    const r = await g.rpc("review_title", { p_title_id: titleId, p_decision: "approve", p_reason: "" });
    const s = await status();
    record("Q1c", "gc_staff review_title(approve) on a title still in 'draft' (never submitted)",
      s === "draft" ? "GATED" : "UNGATED",
      s === "draft"
        ? `rejected: ${r.error?.code} ${r.error?.message}; status still '${s}'`
        : `*** status is now '${s}' ***`);
  }
  // Q1d — the other four RPCs that UPDATE titles: do any of them move status?
  for (const [label, fn] of [
    ["set_release_date", () => g.rpc("set_release_date", { p_title_id: titleId, p_date: "2030-01-01" })],
    ["set_screener_source", () => g.rpc("set_screener_source", { p_title_id: titleId, p_source: "master" })],
    ["set_title_release_info", () => c.rpc("set_title_release_info", {
      p_org_id: orgId, p_title_id: titleId, p_release_type: "new_release", p_original_release_date: null })],
    ["link_title_to_work_of", async () => {
      const { data: other } = await c.rpc("create_title", {
        p_org_id: orgId, p_title: `L7 Other ${run}`, p_release_type: "new_release" });
      return g.rpc("link_title_to_work_of", { p_title_id: titleId, p_target_title_id: other });
    }],
  ]) {
    const r = await fn();
    const s = await status();
    record("Q1d", `${label}() — does it move status as a side effect?`,
      s === "draft" ? "GATED" : "UNGATED",
      s === "draft"
        ? `status unchanged ('${s}')${r?.error ? ` [call returned ${r.error.code}]` : ""}`
        : `*** status moved to '${s}' ***`);
  }

  // ==========================================================================
  console.log("\n--- Q2. is 'in_delivery' required before the title can be DELIVERED? ---");
  console.log(`    (title status at this point: '${await status()}' — never reviewed)\n`);

  let deliveryId = null, linkId = null;

  // Q2a — create a delivery record for a never-reviewed title.
  {
    const r = await g.rpc("create_delivery", {
      p_title_id: titleId, p_vendor_id: vendor.id, p_grant_id: grantId, p_territory: "US",
    });
    deliveryId = r.data ?? null;
    record("Q2a", "gc_staff create_delivery() on a NEVER-REVIEWED title",
      r.error ? "GATED" : "UNGATED",
      r.error
        ? `rejected: ${r.error.code} ${r.error.message}`
        : `*** DELIVERY CREATED *** id=${deliveryId} for a title in '${await status()}' — no review ever happened`);
  }

  // Q2b — mark that delivery live.
  if (!deliveryId) {
    // NOT A PASS. Q2a refused to create the delivery, so there is no delivery to advance and
    // this path was never exercised. It is transitively protected — you cannot set the status
    // of a delivery that cannot exist — but that is an inference, not a measurement, and the
    // gate inside set_delivery_status is unproven by this run. supabase/tests/deliveries_test.sql
    // covers it directly.
    record("Q2b", "gc_staff set_delivery_status('live') on that delivery", "SKIPPED",
      "NOT PROVEN HERE — no delivery exists to test against because Q2a was correctly " +
      "refused. Proven directly by supabase/tests/deliveries_test.sql " +
      "('gate: set_delivery_status REFUSES a delivery whose title never passed review').");
  }
  if (deliveryId) {
    const r = await g.rpc("set_delivery_status", { p_delivery_id: deliveryId, p_status: "live" });
    const { data: d } = await admin.from("deliveries").select("status").eq("id", deliveryId).single();
    record("Q2b", "gc_staff set_delivery_status('live') on that delivery",
      r.error ? "GATED" : "UNGATED",
      r.error ? `rejected: ${r.error.code} ${r.error.message}`
              : `*** delivery.status='${d.status}' *** — the title is live on a platform, unreviewed`);
  }

  // Q2c — mint a master-download portal link (the vendor gets the actual master).
  if (!deliveryId) {
    record("Q2c", "gc_staff create_portal_link() — hand the master to a vendor", "SKIPPED",
      "NOT PROVEN HERE — create_portal_link needs a delivery, and Q2a correctly refused to " +
      "create one. Proven directly by supabase/tests/portal_test.sql " +
      "('gate: create_portal_link REFUSES a delivery whose title is not approved').");
  }
  if (deliveryId) {
    const r = await g.rpc("create_portal_link", {
      p_delivery_id: deliveryId, p_asset_id: assetId,
      p_token_hash: createHash("sha256").update(`l7-${run}`).digest("hex"),
    });
    linkId = r.data ?? null;
    record("Q2c", "gc_staff create_portal_link() — hand the master to a vendor",
      r.error ? "GATED" : "UNGATED",
      r.error ? `rejected: ${r.error.code} ${r.error.message}`
              : `*** MASTER-DOWNLOAD LINK MINTED *** id=${linkId}`);
  }

  // Q2d — mint a screener link.
  {
    const r = await g.rpc("create_screener_link", {
      p_title_id: titleId, p_token_hash: createHash("sha256").update(`l7-scr-${run}`).digest("hex"),
    });
    record("Q2d", "gc_staff create_screener_link() on a never-reviewed title",
      r.error ? "GATED" : "UNGATED",
      r.error ? `rejected: ${r.error.code} ${r.error.message}`
              : `*** SCREENER LINK MINTED *** id=${r.data}`);
  }

  // Q2e — record a metadata export to the vendor.
  {
    const r = await g.rpc("record_export", {
      p_vendor_id: vendor.id, p_title_ids: [titleId], p_payload: { note: "l7" },
    });
    record("Q2e", "gc_staff record_export() including a never-reviewed title",
      r.error ? "GATED" : "UNGATED",
      r.error ? `rejected: ${r.error.code} ${r.error.message}`
              : `*** EXPORT RECORDED *** id=${r.data}`);
  }

  // Q2f — does record_export validate the title ids at all?
  {
    const ghost = randomUUID();
    const r = await g.rpc("record_export", {
      p_vendor_id: vendor.id, p_title_ids: [ghost], p_payload: { note: "nonexistent title" },
    });
    record("Q2f", "record_export() with a title id that does not exist (M4 cross-check)",
      r.error ? "GATED" : "UNGATED",
      r.error ? `rejected: ${r.error.code} ${r.error.message}`
              : `*** ACCEPTED *** export_records row ${r.data} references title ${ghost}, which is not in titles`);
  }

  // ==========================================================================
  console.log("\n--- Q3. which title_status values are reachable at all? ---");
  {
    const { data: enumRows } = await admin.rpc("__nonexistent__").then(() => ({ data: null })).catch(() => ({ data: null }));
    void enumRows;
    const all = ["draft","submitted","in_review","in_delivery","live","takedown_requested","taken_down"];
    // Only submit_title ('in_review') and review_title ('in_delivery'|'draft') write status.
    const written = new Set(["draft", "in_review", "in_delivery"]);
    record("Q3", "title_status values with no code path that ever sets them", "INFO",
      `unreachable: ${all.filter((s) => !written.has(s)).join(", ")} — writable: ${[...written].join(", ")}`);
  }

  // ==========================================================================
  const ungated = results.filter((r) => r.verdict === "UNGATED");
  const skipped = results.filter((r) => r.verdict === "SKIPPED");
  const gated = results.filter((r) => r.verdict === "GATED");
  console.log("\n==================== SUMMARY ====================");
  console.log(`GATED:   ${gated.length}   (measured: the call was made and refused)`);
  console.log(`UNGATED: ${ungated.length}`);
  console.log(`SKIPPED: ${skipped.length}   *** NOT PROVEN — these were never exercised ***`);
  if (skipped.length) {
    console.log("\nSKIPPED is not a pass. Each of these had its precondition removed by an");
    console.log("EARLIER gate firing, so the path is transitively protected but unmeasured here:");
    for (const r of skipped) console.log(`  ${r.id}  ${r.what}`);
    console.log("  -> each names the pgTAP assertion that proves it; both were checked to exist,");
    console.log("     not assumed. Q2c had NO coverage until portal_test.sql gained it.");
  }
  if (ungated.length) {
    console.log("\nUNGATED — reached without the review gate:");
    for (const r of ungated) console.log(`  ${r.id}  ${r.what}\n        ${r.detail}`);
  }
  console.log(`\nFinal title status: '${await status()}' (fixtures left in place, run tag ${run}).`);

  // ---- CI gate ---------------------------------------------------------------
  // BLOCKING as of 2026-07-27, when 20260726000100 reached production. Same shape as
  // b3-cross-org-isolation.mjs: the gate answers "did anything NEW open", not "is the
  // schema perfect", because a gate that is red on arrival gets ignored.
  //
  // Exactly one entry, and it is a DECISION, not a defect parked here. Adding another
  // requires the reason AND the change that will remove it — same rule as B3.
  const KNOWN_OPEN = {
    Q2d: "create_screener_link on a never-reviewed title. Deliberate: screening is HOW " +
         "chain-of-title review is performed, so gating it on 'in_delivery' would make the " +
         "review unperformable. The RPC is gc_staff-only — verified: a client account_owner " +
         "on their own draft title is refused 'Not authorized'. Removed from this baseline " +
         "when the narrower 'must be submitted' floor lands — it is written into " +
         "20260726000100 as an unapplied comment.",
  };

  const ungatedIds = ungated.map((r) => r.id);
  const unexpected = ungatedIds.filter((id) => !(id in KNOWN_OPEN));
  const nowGated = Object.keys(KNOWN_OPEN).filter((id) => !ungatedIds.includes(id));

  console.log("\n---- regression gate ----");
  if (nowGated.length) {
    console.log(`baselined paths now GATED (trim the baseline): ${nowGated.join(", ")}`);
  }
  for (const id of ungatedIds.filter((i) => i in KNOWN_OPEN)) {
    console.log(`known-open (not a regression): ${id} — ${KNOWN_OPEN[id]}`);
  }
  if (unexpected.length) {
    console.log(`\nREGRESSION — ${unexpected.length} ungated path(s) outside the baseline: ${unexpected.join(", ")}`);
    process.exit(1);
  }
  // A SKIP is not a pass, and this gate must not launder one into a pass. Q2b and Q2c are
  // unmeasurable HERE — an earlier gate removes their precondition — so each names the
  // pgTAP assertion that covers it instead, and those run in the same CI job immediately
  // before this script. Any NEW skip means a path stopped being exercised and nobody
  // noticed, which is how the L7 harness produced a false clean twice already.
  const EXPECTED_SKIPS = ["Q2b", "Q2c"];
  const newSkips = skipped.map((r) => r.id).filter((id) => !EXPECTED_SKIPS.includes(id));
  if (newSkips.length) {
    console.log(`\nGATE FAILED — ${newSkips.length} NEW unmeasured path(s): ${newSkips.join(", ")}. ` +
      `A path that was never exercised must not be counted as gated.`);
    process.exit(1);
  }
  if (!gated.length) {
    console.log("\nGATE FAILED — 0 paths measured as GATED. The harness proved nothing.");
    process.exit(1);
  }
  console.log(`no new ungated paths (${gated.length} measured GATED).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR (no verdict):", e.message);
  process.exit(2);
});
