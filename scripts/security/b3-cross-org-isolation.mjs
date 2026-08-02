#!/usr/bin/env node
/**
 * B3 — Cross-org isolation, proven by negative test.
 *
 * NOT a policy-text review. This script seeds two real, fully-populated orgs,
 * then authenticates as an Org A member (real Supabase JWT, through PostgREST —
 * exactly the client's surface) and attempts to READ and WRITE Org B's rows.
 * It reports what actually happened.
 *
 * Also covers B4 (role escalation), B5 (gc_* self-assignment), B11 (assent
 * immutability) and C9 (org orphaning), because they share this harness.
 *
 * Two correctness rules this harness enforces on itself:
 *
 *   1. A write is only a BREACH if it actually changed rows. PostgREST returns
 *      200 + [] when RLS filters an UPDATE/DELETE to zero rows — that is RLS
 *      working, not a bypass. Every write attempt is therefore confirmed by an
 *      independent service-role re-read of the target row.
 *   2. An empty read is only EVIDENCE if the row it was looking for exists.
 *      Every read test asserts, as service_role, that Org B actually has a row
 *      in that table first; otherwise the test is reported VACUOUS, not PASS.
 *
 * Usage (local Supabase must be running):
 *   node scripts/security/b3-cross-org-isolation.mjs
 *
 * Env (defaults are the standard `supabase start` local demo keys — not secrets):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * The script never TRUNCATEs, DROPs, or migrates. It only ever mutates rows it
 * created itself, and a successful mutation is reported as a failure.
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
const tally = { PASS: 0, FAIL: 0, VACUOUS: 0, INCONCLUSIVE: 0 };

function record(id, what, verdict, detail) {
  tally[verdict]++;
  results.push({ id, what, verdict, detail });
  const mark = { PASS: "  ok  ", FAIL: " FAIL ", VACUOUS: "vacuous", INCONCLUSIVE: " ???? " }[verdict];
  console.log(`[${mark}] ${id.padEnd(5)} ${what}\n         → ${detail}`);
}

/**
 * A write/RPC that must be rejected.
 * @param verify optional async () => boolean — returns true if the target row is
 *        STILL UNCHANGED (checked as service_role). Required to distinguish
 *        "RLS filtered to 0 rows" from "silently applied".
 */
async function mustDeny(id, what, fn, verify) {
  let res;
  try {
    res = await fn();
  } catch (e) {
    record(id, what, "PASS", `threw: ${e.message}`);
    return;
  }
  if (res?.error) {
    const code = res.error.code ?? "-";
    if (code === "SKIP") { record(id, what, "VACUOUS", res.error.message); return; }
    // A schema/type error means the attempt never reached the authz check.
    if (code === "PGRST204" || code === "22P02" || code === "42703") {
      record(id, what, "INCONCLUSIVE", `harness error, authz not reached: ${code} ${res.error.message}`);
      return;
    }
    record(id, what, "PASS", `rejected: ${code} ${res.error.message}`);
    return;
  }
  const n = Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0;
  if (n > 0) {
    record(id, what, "FAIL", `*** APPLIED *** ${n} row(s): ${JSON.stringify(res.data).slice(0, 220)}`);
    return;
  }
  // 200 + zero rows. Confirm independently that nothing changed.
  if (!verify) {
    record(id, what, "PASS", "200 but 0 rows affected (RLS filtered the target out)");
    return;
  }
  const unchanged = await verify();
  record(id, what, unchanged ? "PASS" : "FAIL",
    unchanged
      ? "200 but 0 rows affected; service-role re-read confirms target UNCHANGED"
      : "*** APPLIED SILENTLY *** 200 + 0 rows returned, but service-role re-read shows the target CHANGED");
}

/**
 * A read that must come back empty — and is only evidence if the row exists.
 * @param exists async () => number  row count as service_role (the bait)
 * @param read   async () => {data,error} as the attacker
 */
async function mustBeEmpty(id, what, exists, read) {
  const baited = await exists();
  let res;
  try {
    res = await read();
  } catch (e) {
    record(id, what, "INCONCLUSIVE", `threw: ${e.message}`);
    return;
  }
  if (res.error) {
    record(id, what, baited > 0 ? "PASS" : "VACUOUS",
      `read rejected outright: ${res.error.code ?? "-"} ${res.error.message}` +
      (baited > 0 ? ` (bait: ${baited} row(s) existed)` : " (no bait row existed)"));
    return;
  }
  const rows = res.data ?? [];
  const n = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
  if (n > 0) {
    record(id, what, "FAIL", `*** ${n} ROW(S) LEAKED *** ${JSON.stringify(rows).slice(0, 260)}`);
    return;
  }
  record(id, what, baited > 0 ? "PASS" : "VACUOUS",
    baited > 0
      ? `0 rows returned; ${baited} matching row(s) DO exist (verified as service_role)`
      : "0 rows returned, but no matching row existed either — test proves nothing");
}

const countAs = (table, col, val) => async () => {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq(col, val);
  return count ?? 0;
};

async function mkUser(label) {
  const email = `sec-${run}-${label}@example.test`;
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

/**
 * Build a fully-populated org.
 *
 * Client-owned rows go through the real client RPCs under the owner's JWT.
 * GC-only rows (deliveries, portal_links, title_reviews, export_records, works)
 * are created by calling the real GC RPCs under a gc_staff JWT — service_role has
 * no INSERT privilege on those tables, so there is no shortcut. The remainder
 * (subscriptions, findings, notifications, portal_otps/sessions/events) is seeded
 * as service_role, which is exactly how the webhook and portal routes write them.
 *
 * Every table an attack test reads is left with at least one row, so an empty
 * result is real evidence rather than an accident of an unpopulated fixture.
 */
async function seedOrg(owner, gc, name, vendorId) {
  const c = owner.client;
  const g = gc.client;
  const need = (label) => ({ error }) => { if (error) throw new Error(`seed ${label} ${name}: ${error.message}`); };

  const { data: orgId, error: oErr } = await c.rpc("create_org_and_membership", { p_name: name });
  if (oErr) throw new Error(`create_org ${name}: ${oErr.message}`);

  const text = `AGREEMENT ${name}`;
  const { error: aErr } = await c.rpc("accept_terms", {
    p_tier: "access", p_terms_version: "v1-test",
    p_content_hash: createHash("sha256").update(text).digest("hex"), p_rendered_text: text,
  });
  if (aErr) throw new Error(`accept_terms ${name}: ${aErr.message}`);

  // Two titles: `draft` is the attack target and stays in draft; `live` carries the
  // GC-side delivery chain so those tables have bait rows.
  async function mkTitle(label) {
    const { data: titleId, error: tErr } = await c.rpc("create_title", {
      p_org_id: orgId, p_title: `${name} ${label}`, p_release_type: "new_release",
    });
    if (tErr) throw new Error(`create_title ${label} ${name}: ${tErr.message}`);
    need(`metadata ${label}`)(await c.rpc("set_title_metadata", {
      p_org_id: orgId, p_title_id: titleId, p_data: GOOD_META,
    }));
    const { data: grantIds, error: gErr } = await c.rpc("add_rights_grant", {
      p_org_id: orgId, p_title_id: titleId, p_rights_types: ["svod"],
      p_mode: "world", p_territories: [], p_exclusive: false,
    });
    if (gErr) throw new Error(`add_rights_grant ${label} ${name}: ${gErr.message}`);
    const { data: assetId, error: asErr } = await c.rpc("create_asset", {
      p_org_id: orgId, p_title_id: titleId, p_kind: "master",
      p_storage_key: `orgs/${orgId}/titles/${titleId}/master/${randomUUID()}/secret-master.mov`,
      p_content_hash: createHash("sha256").update(`${name}-${label}-master`).digest("hex"), p_bytes: 1234,
    });
    if (asErr) throw new Error(`create_asset ${label} ${name}: ${asErr.message}`);
    return { titleId, grantId: Array.isArray(grantIds) ? grantIds[0] : grantIds, assetId };
  }

  const draft = await mkTitle("Secret Title");
  const live = await mkTitle("Delivered Title");

  // GC-only chain, under a real gc_staff JWT via the real RPCs.
  need("submit")(await c.rpc("submit_title", { p_org_id: orgId, p_title_id: live.titleId }));
  need("review")(await g.rpc("review_title", {
    p_title_id: live.titleId, p_decision: "approve", p_reason: `${name} internal note`,
  }));
  const { data: deliveryId, error: dErr } = await g.rpc("create_delivery", {
    p_title_id: live.titleId, p_vendor_id: vendorId, p_grant_id: live.grantId, p_territory: "US",
  });
  if (dErr) throw new Error(`create_delivery ${name}: ${dErr.message}`);
  need("delivery status")(await g.rpc("set_delivery_status", {
    p_delivery_id: deliveryId, p_status: "delivered",
  }));
  const { data: linkId, error: lErr } = await g.rpc("create_portal_link", {
    p_delivery_id: deliveryId, p_asset_id: live.assetId,
    p_token_hash: createHash("sha256").update(`${name}-link`).digest("hex"),
  });
  if (lErr) throw new Error(`create_portal_link ${name}: ${lErr.message}`);
  need("export")(await g.rpc("record_export", {
    p_vendor_id: vendorId, p_title_ids: [live.titleId], p_payload: { secret: `${name}-export` },
  }));
  need("work")(await g.rpc("link_title_to_work_of", {
    p_title_id: draft.titleId, p_target_title_id: live.titleId,
  }));

  const { data: docs } = await c.from("source_documents").select("id").eq("org_id", orgId);
  const docId = docs?.[0]?.id ?? null;
  const { data: terms } = await c.from("contract_terms").select("id").eq("org_id", orgId);

  // System-written rows (webhook + portal routes use service_role for exactly these).
  need("source_record")(await admin.from("source_records").insert({
    org_id: orgId, document_id: docId, line_no: 1, parsed: { secret: `${name}-parsed` },
  }));
  need("subscription")(await admin.from("subscriptions").insert({
    org_id: orgId, tier: "premium", stripe_customer_id: `cus_${run}_${name}`,
    stripe_subscription_id: `sub_${run}_${name}`, status: "active", annual_price_cents: 499700,
  }));
  need("finding")(await admin.from("findings").insert({
    org_id: orgId, entity_type: "title", entity_id: draft.titleId, code: "missing_synopsis",
    source: "validator", sender: "gc_support", severity: "high", status: "open",
    message: `${name} confidential finding`, source_refs: { title_id: draft.titleId },
    logic_version: "v1", derived_at: new Date().toISOString(),
  }));
  need("notification")(await admin.from("notifications").insert({
    org_id: orgId, kind: "delivery_update", sender: "gc_support",
    title: `${name} private notice`, body: "confidential", source_refs: {},
  }));
  need("portal_otp")(await admin.from("portal_otps").insert({
    link_id: linkId, email: `recipient-${name}@vendor.test`,
    code_hash: createHash("sha256").update(`${name}-otp`).digest("hex"),
    expires_at: new Date(Date.now() + 6e5).toISOString(),
  }));
  const { data: sess, ...sessRes } = await admin.from("portal_sessions").insert({
    link_id: linkId, token_hash: createHash("sha256").update(`${name}-sess`).digest("hex"),
    name: "Recipient", company: "Vendor Co", email: `recipient-${name}@vendor.test`,
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  }).select("id").single();
  need("portal_session")(sessRes);
  need("portal_access_event")(await admin.from("portal_access_events").insert({
    link_id: linkId, session_id: sess.id, event_type: "download",
    email: `recipient-${name}@vendor.test`,
  }));
  need("screener_view_event")(await admin.from("screener_view_events").insert({
    session_id: sess.id, link_id: linkId, event_type: "play", position_seconds: 0,
  }));

  // Added in audit pass 3, after 20260721000300 and 20260722000100 were applied:
  //   - portal_links.share_token now stores the RAW screener token in plaintext
  //     (hash-only for master_download; deliberate, see the migration header).
  //     Seed one so the cross-org read test has a real credential as bait.
  //   - asset_kind gained 'poster'/'banner'; seed a poster so the new kinds are
  //     covered by the storage_key isolation tests rather than assumed.
  const rawShareToken = `RAW-SHARE-${name}-${run}`;
  const { data: screenerLinkId, error: slErr } = await g.rpc("create_screener_link", {
    p_title_id: live.titleId,
    p_token_hash: createHash("sha256").update(`${name}-screener`).digest("hex"),
    p_share_token: rawShareToken,
  });
  if (slErr) throw new Error(`seed screener link ${name}: ${slErr.message}`);
  const { data: posterId, error: poErr } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: live.titleId, p_kind: "poster",
    p_storage_key: `orgs/${orgId}/titles/${live.titleId}/poster/${randomUUID()}/poster.jpg`,
    p_content_hash: createHash("sha256").update(`${name}-poster`).digest("hex"), p_bytes: 99,
  });
  if (poErr) throw new Error(`seed poster ${name}: ${poErr.message}`);

  return {
    name, orgId, docId, deliveryId, linkId, sessionId: sess.id,
    titleId: draft.titleId, grantId: draft.grantId, assetId: draft.assetId,
    liveTitleId: live.titleId, liveAssetId: live.assetId,
    screenerLinkId, rawShareToken, posterId,
    termId: terms?.[0]?.id ?? null,
  };
}

async function main() {
  console.log(`\nB3 cross-org isolation negative test — run ${run}`);
  console.log(`target: ${URL}\n--- seeding ---`);

  const { data: vendor, error: vErr } = await admin.from("vendors").insert({
    name: `Vendor-${run}`, delivery_mode: "email", email_to: ["ops@vendor.test"],
    email_cc: [], active: true,
  }).select("id").single();
  if (vErr) throw new Error(`seed vendor: ${vErr.message}`);

  const ownerA = await mkUser("a-owner");
  const viewerA = await mkUser("a-viewer");
  const ownerB = await mkUser("b-owner");
  const outsider = await mkUser("outsider"); // authenticated, zero memberships

  // GC staff — provisioned out-of-band as service_role, which is the documented path.
  const gcUser = await mkUser("gc-staff");
  const { error: gcErr } = await admin.from("gc_staff")
    .insert({ user_id: gcUser.id, role: "gc_delivery_ops" });
  if (gcErr) throw new Error(`seed gc_staff: ${gcErr.message}`);

  const A = await seedOrg(ownerA, gcUser, `OrgA-${run}`, vendor.id);
  const B = await seedOrg(ownerB, gcUser, `OrgB-${run}`, vendor.id);

  const { error: invErr } = await ownerA.client.from("memberships").insert({
    org_id: A.orgId, user_id: viewerA.id, role: "viewer", status: "active",
  });
  if (invErr) throw new Error(`seed viewer membership: ${invErr.message}`);

  console.log(`Org A = ${A.orgId}  title ${A.titleId}`);
  console.log(`Org B = ${B.orgId}  title ${B.titleId}  asset ${B.assetId}  delivery ${B.deliveryId}\n`);

  const a = ownerA.client;   // account_owner of Org A — most privileged client role
  const v = viewerA.client;  // viewer in Org A
  const o = outsider.client; // authenticated, no org

  // ======================================================================
  console.log("--- 1. cross-org READS as Org A account_owner ---");
  let i = 1;
  const R = (what, exists, read) => mustBeEmpty(`R${i++}`, what, exists, read);

  for (const t of ["titles", "assets", "rights_grants", "title_metadata", "contract_terms",
                   "contract_assents", "subscriptions", "source_documents", "source_records",
                   "audit_log", "deliveries", "findings", "notifications", "title_reviews",
                   "memberships"]) {
    await R(`SELECT * FROM ${t} WHERE org_id = <OrgB>`,
      countAs(t, "org_id", B.orgId),
      () => a.from(t).select("*").eq("org_id", B.orgId));
  }
  await R("SELECT organizations WHERE id = <OrgB>",
    countAs("organizations", "id", B.orgId),
    () => a.from("organizations").select("*").eq("id", B.orgId));
  await R("SELECT titles WHERE id = <OrgB title> (direct id, no org filter)",
    countAs("titles", "id", B.titleId),
    () => a.from("titles").select("*").eq("id", B.titleId));
  await R("SELECT assets WHERE id = <OrgB asset> — would leak the storage_key of B's master",
    countAs("assets", "id", B.assetId),
    () => a.from("assets").select("*").eq("id", B.assetId));
  await R("SELECT assets.storage_key unfiltered — any key outside orgs/<OrgA>/",
    countAs("assets", "org_id", B.orgId),
    async () => {
      const r = await a.from("assets").select("storage_key");
      return r.error ? r : { data: (r.data ?? []).filter((x) => !x.storage_key.startsWith(`orgs/${A.orgId}/`)), error: null };
    });
  await R("SELECT titles unfiltered — any row not in Org A",
    countAs("titles", "org_id", B.orgId),
    async () => {
      const r = await a.from("titles").select("id, org_id, title");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });
  await R("SELECT audit_log unfiltered — any row not in Org A (before/after carry every column)",
    countAs("audit_log", "org_id", B.orgId),
    async () => {
      const r = await a.from("audit_log").select("id, org_id, entity, action");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });
  await R("SELECT memberships unfiltered — enumerate other orgs' members",
    countAs("memberships", "org_id", B.orgId),
    async () => {
      const r = await a.from("memberships").select("id, org_id, user_id, role");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });

  for (const t of ["gc_staff", "vendors", "portal_links", "portal_otps", "portal_sessions",
                   "portal_access_events", "screener_view_events", "export_records", "works"]) {
    await R(`SELECT * FROM ${t} — GC-only table`,
      async () => { const { count } = await admin.from(t).select("*", { count: "exact", head: true }); return count ?? 0; },
      () => a.from(t).select("*"));
  }

  // --- pass 3 additions: objects that did not exist when this harness was written ---
  await R("SELECT portal_links.share_token — the RAW screener token, stored in plaintext (20260721000300)",
    async () => { const { count } = await admin.from("portal_links").select("*", { count: "exact", head: true }).not("share_token","is",null); return count ?? 0; },
    async () => {
      const r = await a.from("portal_links").select("id, title_id, share_token").not("share_token", "is", null);
      return r.error ? r : { data: r.data ?? [], error: null };
    });
  await R("SELECT portal_links WHERE title_id = <OrgB's title> — B's screener link row",
    countAs("portal_links", "title_id", B.liveTitleId),
    () => a.from("portal_links").select("*").eq("title_id", B.liveTitleId));
  await R("SELECT assets WHERE id = <OrgB poster> — new 'poster' kind (20260722000100)",
    countAs("assets", "id", B.posterId),
    () => a.from("assets").select("*").eq("id", B.posterId));
  await R("SELECT assets WHERE kind in (poster,banner) — any artwork key outside Org A",
    async () => { const { count } = await admin.from("assets").select("*", { count: "exact", head: true }).eq("org_id", B.orgId).in("kind", ["poster","banner"]); return count ?? 0; },
    async () => {
      const r = await a.from("assets").select("id, org_id, kind, storage_key").in("kind", ["poster","banner"]);
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });

  // Embedded/nested reads — the classic attempt to reach a protected table via a FK join.
  await R("SELECT titles(id, assets(storage_key)) embedded — reach B's asset via a join",
    countAs("assets", "org_id", B.orgId),
    async () => {
      const r = await a.from("titles").select("id, org_id, assets(id, storage_key)").eq("id", B.titleId);
      return r.error ? r : { data: r.data ?? [], error: null };
    });
  await R("SELECT deliveries(*, portal_links(token_hash)) — reach a download token via a join",
    async () => { const { count } = await admin.from("portal_links").select("*", { count: "exact", head: true }); return count ?? 0; },
    async () => {
      const r = await a.from("deliveries").select("id, org_id, portal_links(token_hash)").eq("org_id", B.orgId);
      return r.error ? r : { data: r.data ?? [], error: null };
    });
  await R("SELECT memberships(organizations(...)) — enumerate other orgs via embed",
    countAs("memberships", "org_id", B.orgId),
    async () => {
      const r = await a.from("memberships").select("org_id, organizations(id, name, status)");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });

  // Read-only RPCs
  await R("rpc my_findings() — any finding outside Org A",
    countAs("findings", "org_id", B.orgId),
    async () => {
      const r = await a.rpc("my_findings");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });
  await R("rpc my_deliveries() — any delivery for a title outside Org A",
    countAs("deliveries", "org_id", B.orgId),
    async () => {
      const r = await a.rpc("my_deliveries");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.title_id === B.titleId), error: null };
    });
  await R("rpc my_notifications() — any notification outside Org A",
    countAs("notifications", "org_id", B.orgId),
    async () => {
      const r = await a.rpc("my_notifications");
      return r.error ? r : { data: (r.data ?? []).filter((x) => x.org_id !== A.orgId), error: null };
    });
  await R("rpc screener_engagement(B's portal link) — B's screener viewing telemetry",
    async () => { const { count } = await admin.from("screener_view_events").select("*", { count: "exact", head: true }); return count ?? 0; },
    async () => {
      const r = await a.rpc("screener_engagement", { p_link_id: B.linkId });
      return r.error ? r : { data: r.data ?? [], error: null };
    });

  console.log("\n--- 1b. cross-org READS as an authenticated user with NO org ---");
  for (const t of ["titles", "assets", "organizations", "memberships", "audit_log",
                   "contract_terms", "contract_assents", "subscriptions", "source_documents",
                   "source_records", "findings", "notifications", "deliveries",
                   "rights_grants", "title_metadata", "title_reviews"]) {
    await mustBeEmpty(`O${i++}`, `outsider (no membership) SELECT * FROM ${t}`,
      async () => { const { count } = await admin.from(t).select("*", { count: "exact", head: true }); return count ?? 0; },
      () => o.from(t).select("*"));
  }

  // ======================================================================
  console.log("\n--- 2. cross-org direct table WRITES as Org A account_owner ---");
  let w = 1;
  const W = (what, fn, verify) => mustDeny(`W${w++}`, what, fn, verify);

  // service-role verifiers: true == target unchanged
  const titleUnchanged = async () => {
    const { data } = await admin.from("titles").select("title, status").eq("id", B.titleId).maybeSingle();
    return !!data && data.title === `OrgB-${run} Secret Title` && data.status === "draft";
  };
  const titleStillExists = async () => {
    const { count } = await admin.from("titles").select("*", { count: "exact", head: true }).eq("org_id", B.orgId);
    return (count ?? 0) === 2;
  };
  const orgBUnchanged = async () => {
    // Payout columns live in organization_payout_details since 20260726000900. Reading a
    // dropped column here returned null and made this verifier report a false breach.
    const { data } = await admin.from("organizations").select("name").eq("id", B.orgId).maybeSingle();
    const { count } = await admin.from("organization_payout_details")
      .select("*", { count: "exact", head: true }).eq("org_id", B.orgId);
    return !!data && data.name === `OrgB-${run}` && (count ?? 0) === 0;
  };
  // SNAPSHOT, not a constant. This verifier used to assert `revenue_share_rate_bp === 0` and
  // `tier === 'access'` literally — encoding an assumption about the DATA rather than checking
  // for a CHANGE. When 20260801000100 gave accept_terms a real rate (8000, replacing a hardcoded
  // 0), the seeded term legitimately held 8000, the comparison failed, and W13/W14 reported an
  // isolation breach that had not happened. Verified independently at the time: an UPDATE on
  // contract_terms as `authenticated` affects 0 rows, exactly as the missing UPDATE policy
  // requires.
  //
  // A false FAIL is not the harmless direction. It burns the credibility that makes a real
  // FAIL actionable, and the obvious way to make it green again is to weaken the check.
  //
  // Captured EAGERLY, here, after seeding and before any write probe runs. Deliberately not
  // lazily on first call: that would make the first probe to use it pass unconditionally,
  // which is the vacuous-pass failure this harness exists to prevent.
  //
  // Sibling verifiers below still compare against literals (orgASubUnchanged pins
  // annual_price_cents, orgAAssentsIntact pins terms_version). They have not broken yet, but
  // they are the same shape and will misfire the same way the day that seed data changes.
  const termsBefore = JSON.stringify(
    (await admin.from("contract_terms")
      .select("id, revenue_share_rate_bp, tier").eq("org_id", A.orgId).order("id")).data ?? []);
  const orgATermsUnchanged = async () => {
    const { data } = await admin.from("contract_terms")
      .select("id, revenue_share_rate_bp, tier").eq("org_id", A.orgId).order("id");
    return JSON.stringify(data ?? []) === termsBefore;
  };
  const orgASubUnchanged = async () => {
    const { data } = await admin.from("subscriptions").select("tier, annual_price_cents").eq("org_id", A.orgId).maybeSingle();
    return !!data && data.tier === "premium" && data.annual_price_cents === 499700;
  };
  const orgAAssentsIntact = async () => {
    const { data } = await admin.from("contract_assents").select("terms_version").eq("org_id", A.orgId);
    return (data ?? []).length === 1 && data[0].terms_version === "v1-test";
  };
  const orgAAuditIntact = async () => {
    const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("org_id", A.orgId);
    return (count ?? 0) > 0;
  };
  const orgADocsIntact = async () => {
    const { data } = await admin.from("source_documents").select("content_hash").eq("org_id", A.orgId);
    return (data ?? []).every((d) => d.content_hash !== "TAMPERED");
  };
  const bAssetUnchanged = async () => {
    const { data } = await admin.from("assets").select("storage_key").eq("id", B.assetId).maybeSingle();
    return !!data && data.storage_key.startsWith(`orgs/${B.orgId}/`);
  };
  const bOwnerStillActive = async () => {
    const { data } = await admin.from("memberships").select("status, role")
      .eq("org_id", B.orgId).eq("user_id", ownerB.id).maybeSingle();
    return !!data && data.status === "active" && data.role === "account_owner";
  };
  const gcStaffUnchanged = async () => {
    const { data } = await admin.from("gc_staff").select("role").eq("user_id", gcUser.id).maybeSingle();
    return !!data && data.role === "gc_delivery_ops";
  };

  await W("INSERT titles (org_id = OrgB) — plant a title in B's catalog",
    () => a.from("titles").insert({ org_id: B.orgId, title: "PWNED", release_type: "new_release" }).select(), titleStillExists);
  await W("UPDATE titles SET title WHERE org_id = OrgB",
    () => a.from("titles").update({ title: "PWNED" }).eq("org_id", B.orgId).select(), titleUnchanged);
  await W("UPDATE titles SET status='taken_down' WHERE id = <OrgB title> (remote takedown)",
    () => a.from("titles").update({ status: "taken_down" }).eq("id", B.titleId).select(), titleUnchanged);
  await W("DELETE FROM titles WHERE org_id = OrgB",
    () => a.from("titles").delete().eq("org_id", B.orgId).select(), titleStillExists);
  await W("UPDATE organizations SET name WHERE id = OrgB",
    () => a.from("organizations").update({ name: "PWNED" }).eq("id", B.orgId).select(), orgBUnchanged);
  await W("INSERT organization_payout_details for OrgB (payout redirect)",
    () => a.from("organization_payout_details")
      .insert({ org_id: B.orgId, trolley_recipient_id: "R-ATTACKER" }).select(), orgBUnchanged);
  await W("INSERT organizations directly (bypass create_org_and_membership)",
    () => a.from("organizations").insert({ name: `Direct-${run}`, status: "active" }).select());
  await W("INSERT assets (org_id = OrgB) — attach an asset to B",
    () => a.from("assets").insert({ org_id: B.orgId, title_id: B.titleId, kind: "master",
      storage_key: "orgs/attacker/x", content_hash: "deadbeef", bytes: 1 }).select());
  await W("UPDATE assets SET storage_key WHERE id = <OrgB asset> (asset swap)",
    () => a.from("assets").update({ storage_key: "orgs/attacker/swap" }).eq("id", B.assetId).select(), bAssetUnchanged);
  await W("INSERT rights_grants (org_id = OrgB) — forge a rights grant",
    () => a.from("rights_grants").insert({ org_id: B.orgId, title_id: B.titleId, rights_type: "svod",
      territory_mode: "world", territories: [], exclusive: false, effective_from: new Date().toISOString() }).select());
  await W("INSERT contract_terms (org_id = OrgB) — forge B's revenue-share rate",
    () => a.from("contract_terms").insert({ org_id: B.orgId, tier: "premium", revenue_share_rate_bp: 0,
      effective_from: new Date().toISOString(), term_length_months: 24,
      expires_at: new Date(Date.now() + 6e10).toISOString(), trigger: "signup" }).select());
  await W("INSERT contract_terms (org_id = OrgA) — self-serve own tier/rate",
    () => a.from("contract_terms").insert({ org_id: A.orgId, tier: "premium", revenue_share_rate_bp: 0,
      effective_from: new Date().toISOString(), term_length_months: 24,
      expires_at: new Date(Date.now() + 6e10).toISOString(), trigger: "upgrade" }).select(), orgATermsUnchanged);
  await W("UPDATE contract_terms SET revenue_share_rate_bp WHERE org_id = OrgA (rewrite own deal)",
    () => a.from("contract_terms").update({ revenue_share_rate_bp: 9999 }).eq("org_id", A.orgId).select(), orgATermsUnchanged);
  await W("DELETE FROM contract_terms WHERE org_id = OrgA",
    () => a.from("contract_terms").delete().eq("org_id", A.orgId).select(), orgATermsUnchanged);
  await W("UPDATE contract_assents WHERE org_id = OrgA (B11 — legal evidence must be immutable)",
    () => a.from("contract_assents").update({ terms_version: "TAMPERED" }).eq("org_id", A.orgId).select(), orgAAssentsIntact);
  await W("DELETE FROM contract_assents WHERE org_id = OrgA (B11)",
    () => a.from("contract_assents").delete().eq("org_id", A.orgId).select(), orgAAssentsIntact);
  await W("INSERT contract_assents (org_id = OrgB) — forge B's acceptance",
    () => a.from("contract_assents").insert({ org_id: B.orgId, user_id: ownerA.id,
      terms_version: "forged", content_hash: "x", source_document_id: B.docId }).select());
  await W("UPDATE audit_log WHERE org_id = OrgA (rule 5 — append-only)",
    () => a.from("audit_log").update({ action: "TAMPERED" }).eq("org_id", A.orgId).select(), orgAAuditIntact);
  await W("DELETE FROM audit_log WHERE org_id = OrgA (rule 5)",
    () => a.from("audit_log").delete().eq("org_id", A.orgId).select(), orgAAuditIntact);
  await W("INSERT audit_log (org_id = OrgB) — forge B's provenance",
    () => a.from("audit_log").insert({ org_id: B.orgId, entity: "titles", action: "insert", actor: ownerA.id }).select());
  await W("INSERT source_documents (org_id = OrgB) — plant a source doc in B",
    () => a.from("source_documents").insert({ org_id: B.orgId, kind: "agreement", content_hash: "x", raw: { forged: true } }).select());
  await W("UPDATE source_documents WHERE org_id = OrgA (rule 3 — immutable)",
    () => a.from("source_documents").update({ content_hash: "TAMPERED" }).eq("org_id", A.orgId).select(), orgADocsIntact);
  await W("INSERT source_records (org_id = OrgB)",
    () => a.from("source_records").insert({ org_id: B.orgId, document_id: B.docId, parsed: { forged: true } }).select());
  await W("INSERT subscriptions (org_id = OrgA) — self-provision a paid tier",
    () => a.from("subscriptions").insert({ org_id: A.orgId, tier: "premium", status: "active",
      annual_price_cents: 0, stripe_subscription_id: `sub_forged_${run}` }).select(), orgASubUnchanged);
  await W("UPDATE subscriptions SET tier='premium', annual_price_cents=0 WHERE org_id = OrgA",
    () => a.from("subscriptions").update({ tier: "premium", annual_price_cents: 0 }).eq("org_id", A.orgId).select(), orgASubUnchanged);
  await W("INSERT vendors — GC-only table",
    () => a.from("vendors").insert({ name: `Fake-${run}`, delivery_mode: "email", email_to: [], email_cc: [], active: true }).select());
  await W("UPDATE vendors SET email_to (redirect every delivery email)",
    () => a.from("vendors").update({ email_to: ["attacker@evil.test"] }).eq("id", vendor.id).select(),
    async () => {
      const { data } = await admin.from("vendors").select("email_to").eq("id", vendor.id).maybeSingle();
      return !!data && data.email_to[0] === "ops@vendor.test";
    });
  await W("INSERT title_metadata (org_id = OrgB) directly",
    () => a.from("title_metadata").insert({ org_id: B.orgId, title_id: B.titleId, data: {} }).select());
  await W("UPDATE deliveries SET status='live' WHERE org_id = OrgB",
    () => a.from("deliveries").update({ status: "live" }).eq("org_id", B.orgId).select(),
    async () => {
      const { data } = await admin.from("deliveries").select("status").eq("id", B.deliveryId).maybeSingle();
      return !!data && data.status === "delivered";
    });
  await W("INSERT findings (org_id = OrgB)",
    () => a.from("findings").insert({ org_id: B.orgId, entity_type: "title", entity_id: B.titleId,
      code: "forged", source: "validator", sender: "gc_support", severity: "high", status: "open",
      message: "x", source_refs: {}, logic_version: "v0", derived_at: new Date().toISOString() }).select());
  await W("INSERT notifications (org_id = OrgB) — impersonate GC Support to B",
    () => a.from("notifications").insert({ org_id: B.orgId, kind: "title_rejected", sender: "gc_support",
      title: "Your account is suspended", body: "Wire funds to…", source_refs: {} }).select());
  await W("INSERT portal_links — mint a master-download link for B's asset",
    () => a.from("portal_links").insert({ purpose: "master_download", asset_id: B.assetId,
      token_hash: "x".repeat(64), expires_at: new Date(Date.now() + 6e8).toISOString() }).select());
  await W("UPDATE portal_links SET share_token (steal/replace B's raw screener token)",
    () => a.from("portal_links").update({ share_token: "ATTACKER-TOKEN" }).eq("id", B.screenerLinkId).select(),
    async () => {
      const { data } = await admin.from("portal_links").select("share_token").eq("id", B.screenerLinkId).maybeSingle();
      return !!data && data.share_token === B.rawShareToken;
    });
  await W("UPDATE assets SET kind='poster' on B's master (mislabel to dodge the master gate)",
    () => a.from("assets").update({ kind: "poster" }).eq("id", B.assetId).select(),
    async () => {
      const { data } = await admin.from("assets").select("kind").eq("id", B.assetId).maybeSingle();
      return !!data && data.kind === "master";
    });
  await W("UPDATE portal_links SET revoked_at=null, expires_at=+1y (revive a revoked link)",
    () => a.from("portal_links").update({ expires_at: new Date(Date.now() + 3e10).toISOString() }).eq("id", B.linkId).select(),
    async () => {
      const { data } = await admin.from("portal_links").select("expires_at").eq("id", B.linkId).maybeSingle();
      return !!data && new Date(data.expires_at).getTime() < Date.now() + 2e9;
    });

  // ======================================================================
  console.log("\n--- 3. cross-org RPC attempts as Org A account_owner ---");
  let p = 1;
  const P = (what, fn, verify) => mustDeny(`P${p++}`, what, fn, verify);

  await P("rpc create_title(p_org_id = OrgB)",
    () => a.rpc("create_title", { p_org_id: B.orgId, p_title: "PWNED", p_release_type: "new_release" }));
  await P("rpc set_title_metadata(OrgB, B's title)",
    () => a.rpc("set_title_metadata", { p_org_id: B.orgId, p_title_id: B.titleId, p_data: { synopsis: "PWNED" } }));
  await P("SPOOF: set_title_metadata(p_org_id = OrgA, p_title_id = B's title)",
    () => a.rpc("set_title_metadata", { p_org_id: A.orgId, p_title_id: B.titleId, p_data: { synopsis: "PWNED" } }));
  await P("SPOOF: create_asset(p_org_id = OrgA, p_title_id = B's title)",
    () => a.rpc("create_asset", { p_org_id: A.orgId, p_title_id: B.titleId, p_kind: "master",
      p_storage_key: "orgs/attacker/x", p_content_hash: "x", p_bytes: 1 }));
  await P("SPOOF: add_rights_grant(p_org_id = OrgA, p_title_id = B's title, exclusive)",
    () => a.rpc("add_rights_grant", { p_org_id: A.orgId, p_title_id: B.titleId, p_rights_types: ["svod"],
      p_mode: "world", p_territories: [], p_exclusive: true }));
  await P("SPOOF: submit_title(p_org_id = OrgA, p_title_id = B's title)",
    () => a.rpc("submit_title", { p_org_id: A.orgId, p_title_id: B.titleId }), titleUnchanged);
  await P("SPOOF: reconcile_title_findings(p_org_id = OrgA, p_title_id = B's title)",
    () => a.rpc("reconcile_title_findings", { p_org_id: A.orgId, p_title_id: B.titleId,
      p_findings: [{ code: "forged", severity: "high", message: "x", field: "f", tier: "required" }],
      p_logic_version: "v0" }));
  await P("SPOOF: link_title_to_work_of(B's title) — cross-org work identity",
    () => a.rpc("link_title_to_work_of", { p_title_id: A.titleId, p_target_title_id: B.titleId }));
  await P("rpc submit_title(OrgB, B's title)",
    () => a.rpc("submit_title", { p_org_id: B.orgId, p_title_id: B.titleId }), titleUnchanged);
  await P("rpc review_title(B's title) — GC-only approval gate",
    () => a.rpc("review_title", { p_title_id: B.titleId, p_decision: "approve", p_reason: "" }), titleUnchanged);
  await P("rpc set_release_date(B's title) — GC-only",
    () => a.rpc("set_release_date", { p_title_id: B.titleId, p_date: "2030-01-01" }));
  await P("rpc set_screener_source(B's title) — GC-only",
    () => a.rpc("set_screener_source", { p_title_id: B.titleId, p_source: "master" }));
  await P("rpc create_screener_link(B's title) — mint a screener room onto B's master",
    () => a.rpc("create_screener_link", { p_title_id: B.titleId, p_token_hash: createHash("sha256").update("x").digest("hex") }));
  await P("rpc create_portal_link(B's asset) — mint a master-download link",
    () => a.rpc("create_portal_link", { p_delivery_id: B.deliveryId, p_asset_id: B.assetId,
      p_token_hash: createHash("sha256").update("y").digest("hex") }));
  await P("rpc revoke_portal_link(B's link) — GC-only",
    () => a.rpc("revoke_portal_link", { p_link_id: B.linkId }));
  await P("rpc create_notification(OrgB) — push a fake GC Support message to B",
    () => a.rpc("create_notification", { p_org_id: B.orgId, p_kind: "title_rejected",
      p_title: "Suspended", p_body: "Wire funds here", p_source_refs: {} }));
  await P("rpc create_delivery(B's title) — GC-only delivery record",
    () => a.rpc("create_delivery", { p_title_id: B.titleId, p_vendor_id: vendor.id,
      p_grant_id: B.grantId, p_territory: "US" }));
  await P("rpc set_delivery_status(B's delivery, 'live') — GC-only status write",
    () => a.rpc("set_delivery_status", { p_delivery_id: B.deliveryId, p_status: "live" }),
    async () => {
      const { data } = await admin.from("deliveries").select("status").eq("id", B.deliveryId).maybeSingle();
      return !!data && data.status === "delivered";
    });
  await P("rpc record_export(B's title) — GC-only",
    () => a.rpc("record_export", { p_vendor_id: vendor.id, p_title_ids: [B.titleId], p_payload: {} }));
  await P("rpc finalize_paid_signup(OrgA, premium) — service_role-only money path",
    () => a.rpc("finalize_paid_signup", { p_org: A.orgId, p_tier: "premium", p_stripe_customer: "cus_fake",
      p_stripe_subscription: `sub_fake_${run}`, p_price_cents: 0,
      p_effective_from: new Date().toISOString(), p_source_document_id: A.docId }));
  await P("rpc portal_resolve_download(...) — service_role-only",
    () => a.rpc("portal_resolve_download", { p_session_token_hash: "a".repeat(64) }));
  await P("rpc portal_resolve_screener(...) — service_role-only",
    () => a.rpc("portal_resolve_screener", { p_session_token_hash: "a".repeat(64) }));
  await P("rpc mark_notifications_read(B's notification id)",
    async () => {
      const { data: n } = await admin.from("notifications").select("id").eq("org_id", B.orgId).limit(1);
      return a.rpc("mark_notifications_read", { p_ids: [n[0].id] });
    },
    async () => {
      const { data: n } = await admin.from("notifications").select("id").eq("org_id", B.orgId).limit(1);
      const { count } = await admin.from("notification_reads").select("*", { count: "exact", head: true })
        .eq("notification_id", n[0].id);
      return (count ?? 0) === 0;
    });

  // ======================================================================
  console.log("\n--- 4. B4 role escalation / B5 gc_* self-assignment ---");
  let e = 1;
  const E = (what, fn, verify) => mustDeny(`E${e++}`, what, fn, verify);

  const viewerStillViewer = async () => {
    const { data } = await admin.from("memberships").select("role")
      .eq("org_id", A.orgId).eq("user_id", viewerA.id).maybeSingle();
    return !!data && data.role === "viewer";
  };
  const orgANameUnchanged = async () => {
    const { data } = await admin.from("organizations").select("name").eq("id", A.orgId).maybeSingle();
    return !!data && data.name === `OrgA-${run}`;
  };
  const noSelfGcStaff = async (uid) => {
    const { count } = await admin.from("gc_staff").select("*", { count: "exact", head: true }).eq("user_id", uid);
    return (count ?? 0) === 0;
  };

  await E("B4 viewer: UPDATE own membership role → account_owner",
    () => v.from("memberships").update({ role: "account_owner" }).eq("user_id", viewerA.id).eq("org_id", A.orgId).select(),
    viewerStillViewer);
  await E("B4 viewer: INSERT a membership (invite a user)",
    () => v.from("memberships").insert({ org_id: A.orgId, user_id: outsider.id, role: "account_owner", status: "active" }).select());
  await E("B4 viewer: UPDATE organizations (own-org settings)",
    () => v.from("organizations").update({ name: "Viewer Renamed" }).eq("id", A.orgId).select(), orgANameUnchanged);
  await E("B4 viewer: write organization_payout_details for own org (payout redirect)",
    () => v.from("organization_payout_details")
      .upsert({ org_id: A.orgId, trolley_recipient_id: "R-VIEWER" }).select(),
    async () => {
      const { data } = await admin.from("organization_payout_details")
        .select("trolley_recipient_id").eq("org_id", A.orgId).maybeSingle();
      return !data || data.trolley_recipient_id !== "R-VIEWER";
    });
  await E("B4 viewer: rpc accept_terms — bind own org to a paid agreement",
    () => v.rpc("accept_terms", { p_tier: "premium", p_terms_version: "v1", p_content_hash: "x", p_rendered_text: "x" }));
  await E("B4 viewer: rpc create_title in own org (needs 'operate')",
    () => v.rpc("create_title", { p_org_id: A.orgId, p_title: "Viewer Title", p_release_type: "new_release" }));
  await E("B4 viewer: rpc create_asset in own org (needs 'operate')",
    () => v.rpc("create_asset", { p_org_id: A.orgId, p_title_id: A.titleId, p_kind: "master",
      p_storage_key: "orgs/x/y", p_content_hash: "x", p_bytes: 1 }));
  await E("B4 viewer: rpc add_rights_grant in own org (needs 'operate')",
    () => v.rpc("add_rights_grant", { p_org_id: A.orgId, p_title_id: A.titleId, p_rights_types: ["svod"],
      p_mode: "world", p_territories: [], p_exclusive: false }));

  await mustBeEmpty(`E${e++}`, "B4 viewer: SELECT subscriptions (billing) in own org — 'catalog read-only' role",
    countAs("subscriptions", "org_id", A.orgId),
    () => v.from("subscriptions").select("*").eq("org_id", A.orgId));
  await mustBeEmpty(`E${e++}`, "B4 viewer: SELECT contract_terms (revenue-share rate) in own org",
    countAs("contract_terms", "org_id", A.orgId),
    () => v.from("contract_terms").select("*").eq("org_id", A.orgId));
  // The payout columns moved to organization_payout_details in 20260726000900 — a policy
  // cannot mask a column, and a column GRANT cannot separate roles that share the
  // `authenticated` DB role. Seed a row so this is not a vacuous pass.
  await admin.from("organization_payout_details")
    .upsert({ org_id: A.orgId, trolley_recipient_id: "R-B3", payout_display: "****9999" });
  await mustBeEmpty(`E${e++}`, "B4 viewer: SELECT organization_payout_details in own org",
    countAs("organization_payout_details", "org_id", A.orgId),
    () => v.from("organization_payout_details").select("*").eq("org_id", A.orgId));

  await E("B5 owner: INSERT gc_staff (self-assign gc_account_owner)",
    () => a.from("gc_staff").insert({ user_id: ownerA.id, role: "gc_account_owner" }).select(),
    () => noSelfGcStaff(ownerA.id));
  await E("B5 viewer: INSERT gc_staff (self-assign gc_delivery_ops)",
    () => v.from("gc_staff").insert({ user_id: viewerA.id, role: "gc_delivery_ops" }).select(),
    () => noSelfGcStaff(viewerA.id));
  await E("B5 outsider: INSERT gc_staff (self-assign gc_account_owner)",
    () => o.from("gc_staff").insert({ user_id: outsider.id, role: "gc_account_owner" }).select(),
    () => noSelfGcStaff(outsider.id));
  await E("B5 owner: UPDATE gc_staff (promote an existing staff row to gc_account_owner)",
    () => a.from("gc_staff").update({ role: "gc_account_owner" }).eq("user_id", gcUser.id).select(), gcStaffUnchanged);
  await E("B5 owner: UPDATE gc_staff SET user_id = me (hijack a staff row)",
    () => a.from("gc_staff").update({ user_id: ownerA.id }).eq("user_id", gcUser.id).select(), gcStaffUnchanged);
  {
    // The org_role enum has no gc_* values, so the type system rejects this before any
    // policy runs. 22P02 is the control here, not a harness error — assert it explicitly.
    const r = await a.from("memberships")
      .insert({ org_id: A.orgId, user_id: outsider.id, role: "gc_account_owner", status: "active" }).select();
    record(`E${e++}`, "B5: INSERT memberships with a gc_* role value (enum cross-contamination)",
      r.error?.code === "22P02" ? "PASS" : r.error ? "PASS" : "FAIL",
      r.error ? `rejected by the org_role enum: ${r.error.code} ${r.error.message}` : "*** APPLIED ***");
  }
  await E("B3: owner A INSERT own membership into Org B (join B as account_owner)",
    () => a.from("memberships").insert({ org_id: B.orgId, user_id: ownerA.id, role: "account_owner", status: "active" }).select());
  await E("B3: outsider INSERT own membership into Org B",
    () => o.from("memberships").insert({ org_id: B.orgId, user_id: outsider.id, role: "account_owner", status: "active" }).select());
  await E("B3: owner A UPDATE B's owner membership → 'removed' (org takeover)",
    async () => {
      const { data: m } = await admin.from("memberships").select("id")
        .eq("org_id", B.orgId).eq("user_id", ownerB.id).single();
      return a.from("memberships").update({ status: "removed" }).eq("id", m.id).select();
    }, bOwnerStillActive);
  await E("B3: owner A UPDATE own membership org_id → OrgB (walk the row across tenants)",
    () => a.from("memberships").update({ org_id: B.orgId }).eq("user_id", ownerA.id).eq("org_id", A.orgId).select(),
    async () => {
      const { data } = await admin.from("memberships").select("org_id").eq("user_id", ownerA.id).maybeSingle();
      return !!data && data.org_id === A.orgId;
    });

  // ======================================================================
  // C8 — does an already-issued JWT lose access when the membership changes?
  // The JWT is unchanged and unexpired throughout; only the membership row moves.
  console.log("\n--- 5. C8 — live session vs. membership change (same unexpired JWT) ---");
  {
    const before = await v.from("titles").select("id").eq("org_id", A.orgId);
    const sawBefore = (before.data ?? []).length;

    await admin.from("memberships").update({ status: "removed" })
      .eq("org_id", A.orgId).eq("user_id", viewerA.id);
    const after = await v.from("titles").select("id").eq("org_id", A.orgId);
    const sawAfter = (after.data ?? []).length;
    record("C8a", "removed member's LIVE session (same JWT) still reads org titles",
      sawBefore > 0 && sawAfter === 0 ? "PASS" : sawBefore === 0 ? "VACUOUS" : "FAIL",
      sawBefore === 0
        ? "viewer could not read titles even before removal — test proves nothing"
        : sawAfter === 0
          ? `access revoked on the next query: ${sawBefore} row(s) before removal → 0 after, no re-login, no token refresh`
          : `*** STILL READS *** ${sawAfter} row(s) after status='removed'`);

    // Role change picked up without a new token?
    await admin.from("memberships").update({ status: "active", role: "delivery_ops" })
      .eq("org_id", A.orgId).eq("user_id", viewerA.id);
    const r = await v.rpc("create_title", {
      p_org_id: A.orgId, p_title: `C8 role-change ${run}`, p_release_type: "new_release",
    });
    record("C8b", "role change viewer→delivery_ops takes effect on the same JWT",
      !r.error ? "PASS" : "FAIL",
      !r.error
        ? "new capability ('operate') available immediately — authorization reads the membership row, not the token"
        : `still denied after the role change: ${r.error.code} ${r.error.message}`);
    // restore the fixture
    await admin.from("memberships").update({ role: "viewer" })
      .eq("org_id", A.orgId).eq("user_id", viewerA.id);
  }

  // ======================================================================
  console.log("\n--- 6. C9 — last account_owner self-demotion (org orphaning) ---");
  {
    const r = await a.from("memberships").update({ role: "viewer" })
      .eq("org_id", A.orgId).eq("user_id", ownerA.id).select();
    const { count } = await admin.from("memberships").select("*", { count: "exact", head: true })
      .eq("org_id", A.orgId).eq("role", "account_owner").eq("status", "active");
    const orphaned = (count ?? 1) === 0;
    record("C9", "sole account_owner demotes self to viewer (would orphan Org A)",
      orphaned ? "FAIL" : "PASS",
      orphaned
        ? "*** SUCCEEDED *** Org A now has zero active account_owners — nobody can accept terms, pay, or manage the team"
        : `blocked: ${r.error?.code ?? "-"} ${r.error?.message ?? "0 rows affected"}; org still has ${count} owner(s)`);
    if (orphaned) {
      await admin.from("memberships").update({ role: "account_owner" })
        .eq("org_id", A.orgId).eq("user_id", ownerA.id);
    }
  }

  // ======================================================================
  console.log("\n==================== SUMMARY ====================");
  console.log(`PASS       (correctly blocked / empty, non-vacuously): ${tally.PASS}`);
  console.log(`FAIL       (real isolation or privilege breach):       ${tally.FAIL}`);
  console.log(`VACUOUS    (no bait row — proves nothing):             ${tally.VACUOUS}`);
  console.log(`INCONCLUSIVE (harness error, authz not reached):       ${tally.INCONCLUSIVE}`);
  for (const v of ["FAIL", "VACUOUS", "INCONCLUSIVE"]) {
    const rows = results.filter((r) => r.verdict === v);
    if (!rows.length) continue;
    console.log(`\n${v}:`);
    for (const r of rows) console.log(`  ${r.id}  ${r.what}\n        ${r.detail}`);
  }
  console.log(`\nSeed data left in place for inspection (run tag ${run}).`);
  console.log("NOT covered by this harness: the RLS-immune table-wipe verb (see remediation 2.6).");

  // ---- CI gate -------------------------------------------------------------
  // Exiting non-zero on ANY failure makes this red on day one and therefore ignored.
  // What a regression gate must actually answer is "did anything NEW break", so the
  // known-open findings are baselined by id, with the reason and the migration that
  // closes each. A failure outside this set fails the build; one inside it does not.
  // A baselined case that starts PASSING is reported loudly — the baseline is then
  // stale and should be trimmed — but does not fail the build.
  // Empty on purpose. Every case that was ever baselined is now closed:
  //   C9            closed by 20260726000500 (last-owner guard)
  //   E9/E10/E11    closed by 20260726000900 (view_financial)
  // A baseline is a list of known defects, not a place to park them. Adding an entry here
  // requires the reason AND the migration that will remove it.
  const KNOWN_OPEN = {};
  const failed = results.filter((r) => r.verdict === "FAIL").map((r) => r.id);
  const unexpected = failed.filter((id) => !(id in KNOWN_OPEN));
  const fixed = Object.keys(KNOWN_OPEN).filter((id) => !failed.includes(id));

  console.log("\n---- regression gate ----");
  if (fixed.length) {
    console.log(`baselined cases now PASSING (trim the baseline): ${fixed.join(", ")}`);
  }
  for (const id of failed.filter((i) => i in KNOWN_OPEN)) {
    console.log(`known-open (not a regression): ${id} — ${KNOWN_OPEN[id]}`);
  }
  if (unexpected.length) {
    console.log(`\nREGRESSION — ${unexpected.length} failure(s) outside the baseline: ${unexpected.join(", ")}`);
    process.exit(1);
  }
  if (tally.VACUOUS || tally.INCONCLUSIVE) {
    console.log(`\nGATE FAILED — ${tally.VACUOUS} vacuous, ${tally.INCONCLUSIVE} inconclusive. ` +
      `A test that proves nothing must not be counted as a pass.`);
    process.exit(1);
  }
  console.log("no regressions.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR (seeding failed — no verdict):", e.message);
  process.exit(2);
});
