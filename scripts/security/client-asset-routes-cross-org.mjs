#!/usr/bin/env node
/**
 * Cross-org test for the two client asset routes added after the audit baseline
 * (7a3b5e3): /api/assets/url and /api/screener/url.
 *
 * Both take a resource id straight from the request body — unlike /api/portal/*, which
 * takes none — so the substitution attack is directly expressible here: authenticate as
 * an Org A member and ask for an Org B asset id / Org B title id.
 *
 * POSITIVE CONTROL FIRST. These routes 401 without a valid @supabase/ssr session cookie,
 * and a 401 on the attack case would look like a pass while proving nothing. So every
 * attack is preceded by the same caller fetching their OWN resource, and the run aborts
 * if that control does not clearly succeed.
 *
 * Reading the codes (AWS is deliberately pinned to fake credentials so nothing can touch
 * production storage):
 *   401 = no/invalid session      -> harness problem, not a result
 *   404 = row invisible to RLS    -> cross-org DENIED (what we want for Org B)
 *   502 = passed auth AND RLS, then failed at the S3 call -> resource WAS visible
 *   202 = passed auth AND RLS, object is restoring        -> resource WAS visible
 *   200 = passed everything and signed a URL              -> resource WAS visible
 *
 * Usage: node scripts/security/run-local-harness.mjs client-assets
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { loadHarnessConfigWithApp } from "./lib/local-harness-config.mjs";

const {
  supabaseUrl: URL_,
  supabaseAnonKey: ANON,
  supabaseServiceRoleKey: SERVICE,
  appUrl: APP,
} = loadHarnessConfigWithApp(process.env);

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const PW = "Passw0rd!-" + run;

// @supabase/ssr stores the session as `sb-<ref>-auth-token`, value `base64-<b64(json)>`.
// For a local stack the ref is the first hostname label: 127.0.0.1 -> "127".
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
const sessionCookie = (s) =>
  `${COOKIE_NAME}=base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;

const results = [];
function record(id, route, what, verdict, detail) {
  results.push({ id, route, what, verdict, detail });
  const mark = { HELD: " HELD ", BREACH: "BREACH", CONTROL: "control", ABORT: "ABORT " }[verdict];
  console.log(`[${mark}] ${id.padEnd(5)} ${route.padEnd(20)} ${what}\n         → ${detail}`);
}

async function post(path, body, cookie) {
  const res = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch { /* html or empty */ }
  return { status: res.status, json };
}

async function mkUser(label) {
  const email = `car-${run}-${label}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await c.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  return { id: data.user.id, email, client: c, cookie: sessionCookie(s.session) };
}

const META = { synopsis: "A film.", runtime_minutes: "96", release_year: "2024",
               genre: "Drama", primary_language: "en", country_of_origin: "US" };

async function seedOrg(owner, name) {
  const c = owner.client;
  const { data: orgId, error: oe } = await c.rpc("create_org_and_membership", { p_name: name });
  if (oe) throw new Error(`org ${name}: ${oe.message}`);
  const txt = `AGREEMENT ${name}`;
  await c.rpc("accept_terms", { p_tier: "access", p_terms_version: "v1",
    p_content_hash: createHash("sha256").update(txt).digest("hex"), p_rendered_text: txt });
  const { data: titleId, error: te } = await c.rpc("create_title", {
    p_org_id: orgId, p_title: `${name} Title`, p_release_type: "new_release" });
  if (te) throw new Error(`title ${name}: ${te.message}`);
  await c.rpc("set_title_metadata", { p_org_id: orgId, p_title_id: titleId, p_data: META });
  const { data: masterId, error: ae } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: titleId, p_kind: "master",
    p_storage_key: `orgs/${orgId}/titles/${titleId}/master/${randomUUID()}/${name}.mov`,
    p_content_hash: createHash("sha256").update(`${name}-m`).digest("hex"), p_bytes: 1234 });
  if (ae) throw new Error(`asset ${name}: ${ae.message}`);
  const { data: posterId } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: titleId, p_kind: "poster",
    p_storage_key: `orgs/${orgId}/titles/${titleId}/poster/${randomUUID()}/${name}.jpg`,
    p_content_hash: createHash("sha256").update(`${name}-p`).digest("hex"), p_bytes: 99 });
  // A second title configured with a DEDICATED screener, so the tightened screener route
  // has a legitimate positive control and the master-fallback case can be tested separately.
  const { data: dedTitleId } = await c.rpc("create_title", {
    p_org_id: orgId, p_title: `${name} Dedicated`, p_release_type: "new_release" });
  await c.rpc("set_title_metadata", { p_org_id: orgId, p_title_id: dedTitleId, p_data: META });
  const { data: dedScreenerId } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: dedTitleId, p_kind: "screener",
    p_storage_key: `orgs/${orgId}/titles/${dedTitleId}/screener/${randomUUID()}/${name}-scr.mp4`,
    p_content_hash: createHash("sha256").update(`${name}-s`).digest("hex"), p_bytes: 555 });
  await admin.from("titles").update({ screener_source: "dedicated" }).eq("id", dedTitleId);

  return { name, orgId, titleId, masterId, posterId, dedTitleId, dedScreenerId };
}

const VISIBLE = new Set([200, 202, 502]);   // reached the storage layer => row was readable
const DENIED  = new Set([404]);             // RLS hid the row

async function main() {
  console.log(`\nClient asset routes — cross-org test — run ${run}\napp: ${APP}\ncookie: ${COOKIE_NAME}\n`);

  const ownerA = await mkUser("a-owner");
  const viewerA = await mkUser("a-viewer");
  const ownerB = await mkUser("b-owner");
  const A = await seedOrg(ownerA, `OrgA-${run}`);
  const B = await seedOrg(ownerB, `OrgB-${run}`);
  const { error: mErr } = await ownerA.client.from("memberships")
    .insert({ org_id: A.orgId, user_id: viewerA.id, role: "viewer", status: "active" });
  if (mErr) throw new Error(`viewer membership: ${mErr.message}`);
  console.log(`A org ${A.orgId} title ${A.titleId} master ${A.masterId}`);
  console.log(`B org ${B.orgId} title ${B.titleId} master ${B.masterId}\n`);

  // ---- POSITIVE CONTROLS -------------------------------------------------
  console.log("--- 0. positive controls (a 404 later means nothing without these) ---");
  const c1 = await post("/api/assets/url", { assetId: A.posterId }, ownerA.cookie);
  record("PC1", "/api/assets/url", "Org A owner fetches their OWN poster (allow-listed kind)",
    VISIBLE.has(c1.status) ? "CONTROL" : "ABORT",
    `HTTP ${c1.status} ${JSON.stringify(c1.json)} — ${VISIBLE.has(c1.status)
      ? "reached the storage layer, so the session cookie and RLS both work"
      : "session cookie is not being accepted; every result below would be a false pass"}`);
  const c2 = await post("/api/screener/url", { titleId: A.dedTitleId }, ownerA.cookie);
  record("PC2", "/api/screener/url", "Org A owner fetches their OWN DEDICATED screener",
    VISIBLE.has(c2.status) ? "CONTROL" : "ABORT",
    `HTTP ${c2.status} ${JSON.stringify(c2.json)}`);

  if (!VISIBLE.has(c1.status) || !VISIBLE.has(c2.status)) {
    console.log("\nABORTING — positive control failed. No verdict is reportable.");
    process.exit(2);
  }

  // ---- CROSS-ORG ---------------------------------------------------------
  console.log("\n--- 1. cross-org: Org A member requests Org B resources ---");
  const cases = [
    ["X1", "/api/assets/url",   "Org A owner  -> Org B MASTER asset id",  ownerA,  { assetId: B.masterId }],
    ["X2", "/api/assets/url",   "Org A owner  -> Org B poster asset id",  ownerA,  { assetId: B.posterId }],
    ["X3", "/api/screener/url", "Org A owner  -> Org B title id",         ownerA,  { titleId: B.titleId }],
    ["X4", "/api/assets/url",   "Org A VIEWER -> Org B MASTER asset id",  viewerA, { assetId: B.masterId }],
    ["X5", "/api/screener/url", "Org A VIEWER -> Org B title id",         viewerA, { titleId: B.titleId }],
  ];
  for (const [id, route, what, who, body] of cases) {
    const r = await post(route, body, who.cookie);
    record(id, route, what,
      DENIED.has(r.status) ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)}` +
      (DENIED.has(r.status) ? " — RLS hid the row" : " *** Org B resource was READABLE ***"));
  }

  console.log("\n--- 1b. the kind filter: masters must be unreachable through these routes ---");
  const kindCases = [
    ["K1", "/api/assets/url",   "Org A VIEWER -> Org A's OWN MASTER (must now fail)",   viewerA, { assetId: A.masterId }],
    ["K2", "/api/assets/url",   "Org A OWNER  -> Org A's OWN MASTER (must now fail)",   ownerA,  { assetId: A.masterId }],
    ["K3", "/api/screener/url", "Org A VIEWER -> own title on screener_source=master",  viewerA, { titleId: A.titleId }],
    ["K4", "/api/screener/url", "Org A OWNER  -> own title on screener_source=master",  ownerA,  { titleId: A.titleId }],
    ["K5", "/api/assets/url",   "Org A OWNER  -> own DEDICATED screener asset id",      ownerA,  { assetId: A.dedScreenerId }],
  ];
  for (const [id, route, what, who, body] of kindCases) {
    const r = await post(route, body, who.cookie);
    record(id, route, what, DENIED.has(r.status) ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)}` +
      (DENIED.has(r.status) ? " — blocked by the kind filter" : " *** MASTER STILL REACHABLE ***"));
  }

  // ---- SAME-ORG ROLE SCOPE (not cross-tenant; the D1 question, at higher stakes) ----
  console.log("\n--- 2. same-org role scope: can a `viewer` pull their own org's MASTER? ---");
  const v1 = await post("/api/assets/url", { assetId: A.posterId }, viewerA.cookie);
  record("R1", "/api/assets/url", "Org A VIEWER -> Org A's OWN poster (allow-listed; should still work)",
    VISIBLE.has(v1.status) ? "CONTROL" : "BREACH",
    `HTTP ${v1.status} ${JSON.stringify(v1.json)} — ` +
    (DENIED.has(v1.status)
      ? "unexpected: an allow-listed kind was blocked"
      : "expected: poster is allow-listed, so the viewer path still works after the kind filter"));
  const v2 = await post("/api/screener/url", { titleId: A.dedTitleId }, viewerA.cookie);
  record("R2", "/api/screener/url", "Org A VIEWER -> own DEDICATED screener (6h TTL; role scope is D1, unchanged)",
    DENIED.has(v2.status) ? "HELD" : "BREACH",
    `HTTP ${v2.status} ${JSON.stringify(v2.json)}`);

  // ---- UNAUTHENTICATED ---------------------------------------------------
  console.log("\n--- 3. unauthenticated ---");
  for (const [route, body] of [["/api/assets/url", { assetId: B.masterId }],
                               ["/api/screener/url", { titleId: B.titleId }]]) {
    const r = await post(route, body, null);
    record("U1", route, "no session cookie",
      r.status === 401 || r.status === 307 ? "HELD" : "BREACH",
      `HTTP ${r.status} — middleware/handler rejected`);
  }

  const breaches = results.filter((r) => r.verdict === "BREACH");
  const crossOrg = results.filter((r) => r.id.startsWith("X"));
  console.log("\n==================== SUMMARY ====================");
  console.log(`cross-org attempts: ${crossOrg.length}, breaches: ${crossOrg.filter(r => r.verdict === "BREACH").length}`);
  console.log(`same-org role-scope findings: ${results.filter(r => r.id.startsWith("R") && r.verdict === "BREACH").length}`);
  if (breaches.length) {
    console.log("\nFLAGGED:");
    for (const b of breaches) console.log(`  ${b.id} ${b.route} — ${b.what}\n      ${b.detail}`);
  }
  // Only a CROSS-ORG breach fails the run. The role-scope findings are reported, not gated,
  // because they are the open D1 decision rather than a regression.
  process.exit(crossOrg.some((r) => r.verdict === "BREACH") ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e.message); process.exit(2); });
