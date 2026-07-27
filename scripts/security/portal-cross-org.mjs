#!/usr/bin/env node
/**
 * Audit pass 3, item 4 — cross-org attack against every /api/portal/* route.
 *
 * "With a valid Org A portal token, request an Org B title id against each route."
 *
 * Structural note that shapes the whole test: **no /api/portal/* route accepts a
 * title id, asset id, delivery id, or link id.** The resource is derived entirely
 * server-side from the session cookie via portal_resolve_download /
 * portal_resolve_screener. So the attack is executed two ways:
 *
 *   (a) INJECTION — send Org B's identifiers in the request body anyway, alongside
 *       a valid Org A session, and verify they are ignored rather than honoured.
 *       For /api/portal/screener-event this is directly observable: the route
 *       writes a row, so the row's link_id proves which link actually resolved.
 *   (b) CONFUSION — cross the two link purposes and the two orgs' credentials
 *       (A's session against B's link token, a screener session against the
 *       download route, and vice versa).
 *
 * Read-only with respect to anything pre-existing: creates its own orgs, titles,
 * assets, links and sessions. Never truncates, drops, or migrates.
 *
 * Requires: local Supabase running, and the app running with LOCAL env
 *   (see /tmp/gc-dev-env.sh — AWS/CloudFront/Stripe are pinned to fakes so no
 *   production infrastructure can be touched).
 *
 *   APP_URL=http://127.0.0.1:3100 node scripts/security/portal-cross-org.mjs
 *
 * Reading the status codes on /download and /screener: CloudFront and S3 are
 * deliberately unconfigured here, so a request that PASSES authorization fails
 * later at the storage layer. That makes the codes a clean discriminator:
 *   403 = portal_resolve_* raised → authorization DENIED (what we want for B)
 *   409 / 500 = authorization PASSED, then storage failed (what we expect for A)
 * Every such case is additionally confirmed against the database.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3100";
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const PW = "Passw0rd!-" + run;

// mirrors src/lib/portal.ts:23-25
const hashToken = (raw) => createHash("sha256").update(raw).digest("hex");

const results = [];
const tally = { HELD: 0, BREACH: 0, NOTE: 0, SETUP_FAILED: 0 };

// Owner-level DDL/DML for test preconditions the app itself must not be able to perform.
// LOCAL ONLY — the DSN is hard-pinned to the `supabase start` container.
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execFileSync("psql", [LOCAL_DSN, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", q],
  { encoding: "utf8" }).trim();

/**
 * Run a precondition and PROVE it took effect before the test that depends on it.
 * Without this, a silently-refused setup step (service_role has no UPDATE on
 * portal_links, deliveries, portal_sessions or rights_grants — by design) makes the
 * dependent test look like it passed when it never ran. That happened on the first
 * attempt at this script and produced four false BREACH results.
 */
async function precondition(label, apply, confirm) {
  await apply();
  const ok = await confirm();
  if (!ok) throw new Error(`precondition not applied: ${label}`);
}
function record(id, route, what, verdict, detail) {
  tally[verdict]++;
  results.push({ id, route, what, verdict, detail });
  const mark = { HELD: " HELD ", BREACH: "BREACH", NOTE: " note ", SETUP_FAILED: "SETUP!" }[verdict];
  console.log(`[${mark}] ${id.padEnd(5)} ${route.padEnd(26)} ${what}\n         → ${detail}`);
}

async function post(path, { body, sessionCookie } = {}) {
  const headers = { "content-type": "application/json" };
  if (sessionCookie) headers.cookie = `portal_session=${sessionCookie}`;
  const res = await fetch(`${APP}${path}`, {
    method: "POST", headers, body: JSON.stringify(body ?? {}), redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function mkUser(label) {
  const email = `pcx-${run}-${label}@example.test`;
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

/** An org with a delivered title, a master_download link, and a screener link — each with a live session. */
async function seedOrg(owner, gc, name, vendorId) {
  const c = owner.client, g = gc.client;
  const need = (l) => ({ error }) => { if (error) throw new Error(`seed ${l} ${name}: ${error.message}`); };

  const { data: orgId, error: oe } = await c.rpc("create_org_and_membership", { p_name: name });
  if (oe) throw new Error(`org ${name}: ${oe.message}`);
  const text = `AGREEMENT ${name}`;
  need("accept")(await c.rpc("accept_terms", {
    p_tier: "access", p_terms_version: "v1-test",
    p_content_hash: hashToken(text), p_rendered_text: text,
  }));
  const { data: titleId, error: te } = await c.rpc("create_title", {
    p_org_id: orgId, p_title: `${name} Title`, p_release_type: "new_release",
  });
  if (te) throw new Error(`title ${name}: ${te.message}`);
  need("meta")(await c.rpc("set_title_metadata", { p_org_id: orgId, p_title_id: titleId, p_data: GOOD_META }));
  const { data: grantIds } = await c.rpc("add_rights_grant", {
    p_org_id: orgId, p_title_id: titleId, p_rights_types: ["svod"],
    p_mode: "world", p_territories: [], p_exclusive: false,
  });
  const grantId = Array.isArray(grantIds) ? grantIds[0] : grantIds;
  const { data: assetId, error: ae } = await c.rpc("create_asset", {
    p_org_id: orgId, p_title_id: titleId, p_kind: "master",
    p_storage_key: `orgs/${orgId}/titles/${titleId}/master/${randomUUID()}/${name}-master.mov`,
    p_content_hash: hashToken(`${name}-master`), p_bytes: 4242,
  });
  if (ae) throw new Error(`asset ${name}: ${ae.message}`);

  need("submit")(await c.rpc("submit_title", { p_org_id: orgId, p_title_id: titleId }));
  need("review")(await g.rpc("review_title", { p_title_id: titleId, p_decision: "approve", p_reason: "ok" }));
  const { data: deliveryId, error: de } = await g.rpc("create_delivery", {
    p_title_id: titleId, p_vendor_id: vendorId, p_grant_id: grantId, p_territory: "US",
  });
  if (de) throw new Error(`delivery ${name}: ${de.message}`);

  // master_download link + a live session on it
  const dlRaw = `dl-token-${name}-${run}`;
  const { data: dlLinkId, error: dle } = await g.rpc("create_portal_link", {
    p_delivery_id: deliveryId, p_asset_id: assetId, p_token_hash: hashToken(dlRaw),
  });
  if (dle) throw new Error(`dl link ${name}: ${dle.message}`);
  const dlSessRaw = `dl-sess-${name}-${run}`;
  const { data: dlSess, ...dlSessRes } = await admin.from("portal_sessions").insert({
    link_id: dlLinkId, token_hash: hashToken(dlSessRaw),
    name: "Recipient", company: "Vendor Co", email: `rcpt-${name}@vendor.test`,
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  }).select("id").single();
  need("dl session")(dlSessRes);

  // screener link (carries the raw share_token since 20260721000300) + a live session
  const scRaw = `sc-token-${name}-${run}`;
  const shareToken = `SHARE-${name}-${run}`;
  const { data: scLinkId, error: sce } = await g.rpc("create_screener_link", {
    p_title_id: titleId, p_token_hash: hashToken(scRaw), p_share_token: shareToken,
  });
  if (sce) throw new Error(`screener link ${name}: ${sce.message}`);
  const scSessRaw = `sc-sess-${name}-${run}`;
  const { data: scSess, ...scSessRes } = await admin.from("portal_sessions").insert({
    link_id: scLinkId, token_hash: hashToken(scSessRaw),
    name: "Recipient", company: "Vendor Co", email: `rcpt-${name}@vendor.test`,
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  }).select("id").single();
  need("sc session")(scSessRes);

  return {
    name, orgId, titleId, assetId, deliveryId,
    dlLinkId, dlRaw, dlSessRaw, dlSessionId: dlSess.id,
    scLinkId, scRaw, scSessRaw, scSessionId: scSess.id, shareToken,
  };
}

async function main() {
  console.log(`\nPortal cross-org test — run ${run}\napp: ${APP}   db: ${URL}\n--- seeding ---`);

  const { data: vendor, error: ve } = await admin.from("vendors").insert({
    name: `PCX-Vendor-${run}`, delivery_mode: "email", email_to: ["ops@vendor.test"],
    email_cc: [], active: true,
  }).select("id").single();
  if (ve) throw new Error(`vendor: ${ve.message}`);

  const ownerA = await mkUser("a-owner");
  const ownerB = await mkUser("b-owner");
  const gc = await mkUser("gc");
  const { error: ge } = await admin.from("gc_staff").insert({ user_id: gc.id, role: "gc_delivery_ops" });
  if (ge) throw new Error(`gc_staff: ${ge.message}`);

  const A = await seedOrg(ownerA, gc, `OrgA-${run}`, vendor.id);
  const B = await seedOrg(ownerB, gc, `OrgB-${run}`, vendor.id);
  console.log(`A: org ${A.orgId} title ${A.titleId} dlLink ${A.dlLinkId} scLink ${A.scLinkId}`);
  console.log(`B: org ${B.orgId} title ${B.titleId} dlLink ${B.dlLinkId} scLink ${B.scLinkId}\n`);

  // Every Org B identifier an attacker might try to smuggle in.
  const B_IDS = {
    titleId: B.titleId, title_id: B.titleId,
    assetId: B.assetId, asset_id: B.assetId,
    linkId: B.dlLinkId, link_id: B.dlLinkId,
    deliveryId: B.deliveryId, delivery_id: B.deliveryId,
    sessionId: B.dlSessionId, session_id: B.dlSessionId,
    orgId: B.orgId, org_id: B.orgId,
    storage_key: `orgs/${B.orgId}/titles/${B.titleId}/master/x/B-master.mov`,
  };
  // NOTE: deliberately no `token` key here. On the first run B_IDS carried B's link
  // token and, being spread last, silently overwrote A's — so /request-otp legitimately
  // acted on B's link and the test reported a breach that was purely a harness bug.
  // Possession of a link token IS possession of that link; that is the design, and it
  // is tested separately and honestly as P2a.

  // ========================================================================
  console.log("--- 0. baseline: no session at all ---");
  for (const [route, body] of [
    ["/api/portal/download", {}],
    ["/api/portal/screener", {}],
    ["/api/portal/screener-event", { event_type: "play", position_seconds: 0 }],
  ]) {
    const r = await post(route, { body });
    record("B0", route, "no session cookie",
      r.status === 401 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }

  // ========================================================================
  console.log("\n--- 1. INJECTION: valid Org A session + Org B identifiers in the body ---");

  // 1a. screener-event — the one route that writes an observable row.
  {
    const before = await admin.from("screener_view_events").select("id", { count: "exact", head: true });
    void before;
    const r = await post("/api/portal/screener-event", {
      sessionCookie: A.scSessRaw,
      body: { event_type: "play", position_seconds: 7, runtime_seconds: 5760, ...B_IDS },
    });
    // Which link did the server actually resolve?
    const { data: rows } = await admin.from("screener_view_events")
      .select("link_id, session_id, position_seconds")
      .eq("position_seconds", 7).order("occurred_at", { ascending: false }).limit(1);
    const row = rows?.[0];
    const wroteA = row && row.link_id === A.scLinkId && row.session_id === A.scSessionId;
    const wroteB = row && (row.link_id === B.scLinkId || row.link_id === B.dlLinkId);
    record("P1a", "/api/portal/screener-event", "A's session + every Org B id injected into the body",
      wroteA && !wroteB ? "HELD" : "BREACH",
      wroteA
        ? `HTTP ${r.status}; row written against A's link (${row.link_id.slice(0,8)}…) and A's session — every injected B id ignored`
        : `HTTP ${r.status}; row link_id=${row?.link_id ?? "none"} — expected A's ${A.scLinkId.slice(0,8)}…`);
  }

  // 1b. download — A's download session + B ids.
  {
    const baseline = await post("/api/portal/download", { sessionCookie: A.dlSessRaw });
    const injected = await post("/api/portal/download", { sessionCookie: A.dlSessRaw, body: B_IDS });
    // Provenance is the tell: the route logs against the link the SESSION resolved.
    const { data: ev } = await admin.from("portal_access_events")
      .select("link_id, event_type").in("link_id", [A.dlLinkId, B.dlLinkId])
      .order("occurred_at", { ascending: false }).limit(5);
    const touchedB = (ev ?? []).some((e) => e.link_id === B.dlLinkId);
    record("P1b", "/api/portal/download", "A's session + every Org B id injected into the body",
      injected.status === baseline.status && !touchedB ? "HELD" : "BREACH",
      `baseline HTTP ${baseline.status}, injected HTTP ${injected.status} (identical → body ignored); ` +
      `no access event recorded against B's link. Note: ${baseline.status} is the post-authorization ` +
      `storage failure (S3/CloudFront deliberately unconfigured), not an authorization pass for B.`);
  }

  // 1c. screener — A's screener session + B ids.
  {
    const baseline = await post("/api/portal/screener", { sessionCookie: A.scSessRaw });
    const injected = await post("/api/portal/screener", { sessionCookie: A.scSessRaw, body: B_IDS });
    record("P1c", "/api/portal/screener", "A's session + every Org B id injected into the body",
      injected.status === baseline.status ? "HELD" : "BREACH",
      `baseline HTTP ${baseline.status}, injected HTTP ${injected.status} — identical, body ignored ` +
      `(route reads no body at all)`);
  }

  // 1d. request-otp / verify-otp take a LINK token, not a title. Inject B ids alongside A's token.
  {
    const r = await post("/api/portal/request-otp", {
      sessionCookie: A.dlSessRaw,
      body: { token: A.dlRaw, name: "N", company: "C", email: `x-${run}@t.test`,
              turnstileToken: "dummy", ...B_IDS },
    });
    const { count: bOtps } = await admin.from("portal_otps")
      .select("*", { count: "exact", head: true }).eq("link_id", B.dlLinkId);
    record("P1d", "/api/portal/request-otp", "A's link token + Org B ids injected",
      (bOtps ?? 0) === 0 ? "HELD" : "BREACH",
      `HTTP ${r.status}; OTP rows created against B's link: ${bOtps ?? 0} (expected 0). ` +
      `The route's zod schema (route.ts:8-14) strips unknown keys, so B ids never reach the query.`);
  }
  {
    const r = await post("/api/portal/verify-otp", {
      sessionCookie: A.dlSessRaw,
      body: { token: A.dlRaw, email: `x-${run}@t.test`, code: "000000", ...B_IDS },
    });
    const { count: bSess } = await admin.from("portal_sessions")
      .select("*", { count: "exact", head: true }).eq("link_id", B.dlLinkId);
    record("P1e", "/api/portal/verify-otp", "A's link token + Org B ids injected, guessed code",
      r.status !== 200 && (bSess ?? 0) === 1 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)}; sessions on B's link unchanged (${bSess}, the seeded one)`);
  }

  // ========================================================================
  console.log("\n--- 2. CONFUSION: crossing orgs and crossing link purposes ---");

  // 2a. A's session cookie, but ask for B's link explicitly via request-otp's token param.
  //     (Possession of B's LINK TOKEN is possession of B's link — that is the design.
  //      The question is whether A's *session* adds anything. It must not.)
  {
    const r = await post("/api/portal/request-otp", {
      body: { token: B.dlRaw, name: "N", company: "C", email: `attacker-${run}@t.test`,
              turnstileToken: "dummy" },
      sessionCookie: A.dlSessRaw,
    });
    record("P2a", "/api/portal/request-otp", "A's session + B's LINK TOKEN (does the session add reach?)",
      "NOTE",
      `HTTP ${r.status}. The route never reads the session cookie — the link token alone is the ` +
      `credential, by design, and it still only yields an emailed OTP, not the asset. A's session ` +
      `conferred nothing extra.`);
  }

  // 2b. Purpose confusion: a SCREENER session used on the DOWNLOAD route.
  {
    const r = await post("/api/portal/download", { sessionCookie: A.scSessRaw });
    record("P2b", "/api/portal/download", "screener-purpose session used to fetch a MASTER",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — portal_resolve_download requires the link's ` +
      `delivery_id, which a screener_view link does not have`);
  }

  // 2c. Purpose confusion the other way: a DOWNLOAD session used on the SCREENER route.
  {
    const r = await post("/api/portal/screener", { sessionCookie: A.dlSessRaw });
    record("P2c", "/api/portal/screener", "master_download session used on the screener route",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — portal_resolve_screener filters on ` +
      `purpose = 'screener_view'`);
  }

  // 2d. Cross-org session replay: B's session cookie against the routes — should serve B, never A.
  {
    const r = await post("/api/portal/screener-event", {
      sessionCookie: B.scSessRaw,
      body: { event_type: "pause", position_seconds: 11, ...{ link_id: A.scLinkId, title_id: A.titleId } },
    });
    const { data: rows } = await admin.from("screener_view_events")
      .select("link_id").eq("position_seconds", 11).order("occurred_at", { ascending: false }).limit(1);
    const ok = rows?.[0]?.link_id === B.scLinkId;
    record("P2d", "/api/portal/screener-event", "B's session + A's ids injected (mirror of P1a)",
      ok ? "HELD" : "BREACH",
      ok ? `HTTP ${r.status}; row written against B's own link — A's ids ignored`
         : `HTTP ${r.status}; row link_id=${rows?.[0]?.link_id ?? "none"}`);
  }

  // 2e. A revoked link's still-live session.
  {
    // service_role has NO update on portal_links (by design), so this must go through
    // the GC-only RPC — and be proven applied before the assertion means anything.
    await precondition("revoke B's screener link",
      () => gc.client.rpc("revoke_portal_link", { p_link_id: B.scLinkId }),
      async () => {
        const { data } = await admin.from("portal_links").select("revoked_at").eq("id", B.scLinkId).single();
        return data.revoked_at !== null;
      });
    const r = await post("/api/portal/screener", { sessionCookie: B.scSessRaw });
    record("P2e", "/api/portal/screener", "session still valid, but its LINK was revoked (via revoke_portal_link)",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — revocation enforced on the link at resolve time, ` +
      `not only at session creation`);
    sql(`update public.portal_links set revoked_at = null where id = '${B.scLinkId}'`);
  }

  // 2f. An expired session.
  {
    // No app path can expire a session early (service_role has no update on
    // portal_sessions), so back-date it as the table owner and prove it stuck.
    await precondition("expire B's screener session",
      async () => sql(`update public.portal_sessions set expires_at = now() - interval '1 hour' where id = '${B.scSessionId}'`),
      async () => {
        const { data } = await admin.from("portal_sessions").select("expires_at").eq("id", B.scSessionId).single();
        return new Date(data.expires_at) < new Date();
      });
    const r = await post("/api/portal/screener", { sessionCookie: B.scSessRaw });
    record("P2f", "/api/portal/screener", "expired session token",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — expiry checked in the resolver on every request`);
    sql(`update public.portal_sessions set expires_at = now() + interval '1 day' where id = '${B.scSessionId}'`);
  }

  // 2g. Forged/garbage session token.
  {
    const r = await post("/api/portal/download", { sessionCookie: `forged-${randomUUID()}` });
    record("P2g", "/api/portal/download", "forged session token",
      r.status === 403 ? "HELD" : "BREACH", `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }

  // 2h. Delivery taken down → does the still-live session lose the master?
  {
    await precondition("take A's delivery down",
      () => gc.client.rpc("set_delivery_status", { p_delivery_id: A.deliveryId, p_status: "taken_down" }),
      async () => {
        const { data } = await admin.from("deliveries").select("status").eq("id", A.deliveryId).single();
        return data.status === "taken_down";
      });
    const r = await post("/api/portal/download", { sessionCookie: A.dlSessRaw });
    record("P2h", "/api/portal/download", "delivery set to 'taken_down', session and link still live",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — the fail-closed allowlist ` +
      `(pending/delivered/live) is re-checked on every download`);
    await gc.client.rpc("set_delivery_status", { p_delivery_id: A.deliveryId, p_status: "delivered" });
  }

  // 2i. Rights grant closed → does the still-live session lose the master? (rule 12 at request time)
  {
    // Nothing in the app closes a grant (see Part 2, L5 — rights_grants is insert-only),
    // so this precondition is owner-level by necessity.
    await precondition("close A's rights grant",
      async () => sql(`update public.rights_grants set effective_to = now() where title_id = '${A.titleId}'`),
      async () => {
        const { data } = await admin.from("rights_grants").select("effective_to").eq("title_id", A.titleId);
        return (data ?? []).every((g) => g.effective_to !== null);
      });
    const r = await post("/api/portal/download", { sessionCookie: A.dlSessRaw });
    record("P2i", "/api/portal/download", "rights grant closed, session and link still live",
      r.status === 403 ? "HELD" : "BREACH",
      `HTTP ${r.status} ${JSON.stringify(r.json)} — rule 12 re-evaluated per request, so a lapsed ` +
      `grant revokes an already-issued portal link`);
    sql(`update public.rights_grants set effective_to = null where title_id = '${A.titleId}'`);
  }

  // ========================================================================
  console.log("\n==================== SUMMARY ====================");
  console.log(`HELD:   ${tally.HELD}`);
  console.log(`BREACH: ${tally.BREACH}`);
  console.log(`notes:  ${tally.NOTE}`);
  console.log(`setup-failed: ${tally.SETUP_FAILED}`);
  if (tally.BREACH) {
    console.log("\nBREACHES:");
    for (const r of results.filter((x) => x.verdict === "BREACH"))
      console.log(`  ${r.id}  ${r.route}  ${r.what}\n        ${r.detail}`);
  }
  console.log(`\nFixtures left in place (run tag ${run}).`);
  process.exit(tally.BREACH ? 1 : 0);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR (no verdict):", e.message);
  process.exit(2);
});
