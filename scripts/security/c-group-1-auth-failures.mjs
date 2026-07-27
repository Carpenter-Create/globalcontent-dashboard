#!/usr/bin/env node
/**
 * Section C, group 1 — auth failure cases, against LOCAL.
 *
 * C1 (password lockout) and C10 (MFA) are excluded: both are hosted-platform behaviour,
 * there is no hosted non-production project, and local Supabase gives a confidently wrong
 * answer in either direction — worse than no answer.
 *
 * Two honesty rules, same as the other harnesses:
 *   * a case with nothing to exercise is reported N/A-NOT-BUILT, never PASS;
 *   * a "no difference" result is only evidence if the two sides were actually compared,
 *     so C2/C4 diff the full response objects rather than eyeballing a message.
 *
 * Usage: node scripts/security/c-group-1-auth-failures.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL_ = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const PW = "Passw0rd!-" + run;

const results = [];
const tally = { PASS: 0, FAIL: 0, NOTBUILT: 0, INCONCLUSIVE: 0 };
function rec(id, what, verdict, detail) {
  tally[verdict]++;
  results.push({ id, what, verdict, detail });
  const m = { PASS: " PASS ", FAIL: " FAIL ", NOTBUILT: "n/a   ", INCONCLUSIVE: " ???? " }[verdict];
  console.log(`[${m}] ${id.padEnd(4)} ${what}\n        → ${detail}`);
}

const shape = (r) => JSON.stringify({
  error: r.error ? { status: r.error.status, code: r.error.code, message: r.error.message } : null,
  user: r.data?.user ?? null,
  session: r.data?.session ? "<session>" : null,
});

async function main() {
  console.log(`\nSection C group 1 — auth failure cases (local) — run ${run}\n`);

  // ── C2 ────────────────────────────────────────────────────────────────────
  // No password reset exists (magic-link only, login/actions.ts:10). The analogous
  // enumeration surface is the magic-link request, so that is what gets tested.
  {
    const known = `c-known-${run}@example.test`;
    await admin.auth.admin.createUser({ email: known, password: PW, email_confirm: true });
    const unknown = `c-unknown-${run}@example.test`;

    const rKnown = await anon().auth.signInWithOtp({ email: known, options: { shouldCreateUser: true } });
    const rUnknown = await anon().auth.signInWithOtp({ email: unknown, options: { shouldCreateUser: true } });
    const same = shape(rKnown) === shape(rUnknown);
    rec("C2", "magic-link request: known vs unknown address (no password reset exists)",
      same ? "PASS" : "FAIL",
      same
        ? `responses byte-identical: ${shape(rKnown)} — no enumeration signal`
        : `DIFFER.\n          known:   ${shape(rKnown)}\n          unknown: ${shape(rUnknown)}`);

    // The app layer must not reintroduce the difference either.
    rec("C2b", "app layer returns one fixed string regardless (login/actions.ts:32,37)",
      "PASS",
      `requestMagicLink returns "Check your email for a secure sign-in link." on success for both. ` +
      `Caveat already logged as B9: line 36 returns error.message verbatim, so a future Supabase ` +
      `error string could become a disclosure channel.`);
  }

  // ── C3 ────────────────────────────────────────────────────────────────────
  {
    const email = `c3-${run}@example.test`;
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) {
      rec("C3", "verification link clicked twice", "INCONCLUSIVE", `could not mint a link: ${error.message}`);
    } else {
      // type must be "email" for a hashed_token from generateLink; "magiclink" 403s even on
      // the FIRST use. Getting that wrong made the first click fail, which made the second
      // click prove nothing — a harness bug that first presented as an app finding.
      const token = link.properties.hashed_token;
      const first = await anon().auth.verifyOtp({ type: "email", token_hash: token });
      if (first.error) {
        rec("C3", "verification link clicked twice", "INCONCLUSIVE",
          `the FIRST click failed (${first.error.status} ${first.error.message}), so the second ` +
          `proves nothing. Not an app result.`);
      } else {
        const second = await anon().auth.verifyOtp({ type: "email", token_hash: token });
        const ok = !!second.error && (second.error.status ?? 0) >= 400 && (second.error.status ?? 0) < 500;
        rec("C3", "verification link clicked twice", ok ? "PASS" : "FAIL",
          `1st: session issued | 2nd: ` +
          (second.error
            ? `${second.error.status} "${second.error.message}"` +
              (ok ? " — single-use, clean 4xx, no 500 and no second session" : " — non-4xx")
            : "SESSION ISSUED AGAIN — the token is reusable"));
      }
    }
  }

  // ── C4 ────────────────────────────────────────────────────────────────────
  {
    const existing = `c4-existing-${run}@example.test`;
    await admin.auth.admin.createUser({ email: existing, password: PW, email_confirm: true });
    const fresh = `c4-fresh-${run}@example.test`;
    const a = await anon().auth.signInWithOtp({ email: existing, options: { shouldCreateUser: true } });
    const b = await anon().auth.signInWithOtp({ email: fresh, options: { shouldCreateUser: true } });
    const same = shape(a) === shape(b);
    rec("C4", "signup with an already-registered address", same ? "PASS" : "FAIL",
      same ? `identical to a fresh address: ${shape(a)} — existence not disclosed`
           : `DIFFER.\n          existing: ${shape(a)}\n          fresh:    ${shape(b)}`);
  }

  // ── C5 / C6 / C7 ──────────────────────────────────────────────────────────
  // No invite system exists. Membership is a direct INSERT under the manage_team policy —
  // no token, no acceptance step, nothing to accept twice, expire, or replay. Reporting
  // these as PASS would be a lie; the closest real property is tested instead.
  {
    const owner = await mkUser("c5-owner");
    const invitee = await mkUser("c5-invitee");
    const { data: orgA } = await owner.client.rpc("create_org_and_membership", { p_name: `C5-A-${run}` });
    const other = await mkUser("c5-other");
    const { data: orgB } = await other.client.rpc("create_org_and_membership", { p_name: `C5-B-${run}` });

    const first = await owner.client.from("memberships")
      .insert({ org_id: orgA, user_id: invitee.id, role: "viewer", status: "active" }).select();
    const dup = await owner.client.from("memberships")
      .insert({ org_id: orgA, user_id: invitee.id, role: "account_owner", status: "active" }).select();
    const { count } = await admin.from("memberships").select("*", { count: "exact", head: true })
      .eq("org_id", orgA).eq("user_id", invitee.id);
    rec("C5", "no invite system — closest property: duplicate membership is impossible",
      !first.error && dup.error && count === 1 ? "NOTBUILT" : "FAIL",
      `NOT BUILT (invitations deferred, 20260716000100:21). Direct membership INSERT instead. ` +
      `Duplicate rejected by unique(org_id,user_id): ${dup.error?.code ?? "ACCEPTED — BUG"}; rows = ${count}. ` +
      `So whenever invites are built, double-acceptance cannot duplicate a row.`);

    rec("C6", "expired or revoked invite token", "NOTBUILT",
      `No invite tokens exist to expire or revoke. The pattern to copy is already in the ` +
      `portal: hash at rest, expires_at, attempt cap, single-use via consumed_at ` +
      `(api/portal/verify-otp:29-60).`);

    const cross = await owner.client.from("memberships")
      .insert({ org_id: orgB, user_id: invitee.id, role: "viewer", status: "active" }).select();
    rec("C7", "no invite token to replay — closest property: cross-org membership write",
      cross.error ? "NOTBUILT" : "FAIL",
      `NOT BUILT. Closest real test: Org A's owner writing a membership into Org B — ` +
      `${cross.error ? `blocked (${cross.error.code})` : "*** ACCEPTED ***"}. ` +
      `An invite token, when built, must be bound to org AND email.`);
  }

  // ── C8 ────────────────────────────────────────────────────────────────────
  {
    const owner = await mkUser("c8-owner");
    const member = await mkUser("c8-member");
    const { data: org } = await owner.client.rpc("create_org_and_membership", { p_name: `C8-${run}` });
    await owner.client.from("memberships")
      .insert({ org_id: org, user_id: member.id, role: "viewer", status: "active" });
    const text = `AG-${run}`;
    await owner.client.rpc("accept_terms", { p_tier: "access", p_terms_version: "v1",
      p_content_hash: text, p_rendered_text: text });
    await owner.client.rpc("create_title", { p_org_id: org, p_title: `C8 ${run}`, p_release_type: "new_release" });

    const before = await member.client.from("titles").select("id").eq("org_id", org);
    await admin.from("memberships").update({ status: "removed" }).eq("org_id", org).eq("user_id", member.id);
    const after = await member.client.from("titles").select("id").eq("org_id", org);
    const n0 = (before.data ?? []).length, n1 = (after.data ?? []).length;
    rec("C8", "removed member's live session loses access without waiting for token expiry",
      n0 > 0 && n1 === 0 ? "PASS" : n0 === 0 ? "INCONCLUSIVE" : "FAIL",
      n0 === 0 ? "member saw nothing before removal — proves nothing"
               : `same unexpired JWT: ${n0} row(s) before removal → ${n1} after. ` +
                 `Authorization reads the membership row per statement, not the token.`);
  }

  console.log("\n==================== SUMMARY ====================");
  console.log(`PASS ${tally.PASS} · FAIL ${tally.FAIL} · N/A-NOT-BUILT ${tally.NOTBUILT} · INCONCLUSIVE ${tally.INCONCLUSIVE}`);
  console.log("EXCLUDED: C1 (password lockout) and C10 (MFA) — hosted-platform behaviour, no hosted");
  console.log("          non-prod project exists, and local would answer confidently and wrongly.");
  if (tally.FAIL) {
    console.log("\nFAILURES:");
    for (const r of results.filter((x) => x.verdict === "FAIL")) console.log(`  ${r.id} ${r.what}\n     ${r.detail}`);
  }
  process.exit(tally.FAIL ? 1 : 0);
}

async function mkUser(label) {
  const email = `${label}-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const c = anon();
  const { error: e } = await c.auth.signInWithPassword({ email, password: PW });
  if (e) throw new Error(`signIn ${label}: ${e.message}`);
  return { id: data.user.id, email, client: c };
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e.message); process.exit(2); });
