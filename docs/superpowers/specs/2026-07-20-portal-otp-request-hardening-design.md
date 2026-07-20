# Portal OTP-request hardening — Turnstile + issuance caps — design

> Status: design pending approval. Closes the pre-go-live gate both portal reviews flagged:
> `/api/portal/request-otp` is public + unauthenticated and sends real Resend emails to any address a
> link-holder supplies. Adds three **app-layer** anti-abuse defenses (no new provisioning, no new
> table, no migration). Builds on Portal-1/2/3. This is Portal-1's endpoint; authored as a small slice
> stacked on `portal-3-glacier-restoring` to avoid rebasing the open stack.

## Context

`request-otp` is the one portal endpoint reachable without any prior trust: a link token + a
self-supplied email trigger a real transactional email. Left open it is (a) a scripted email-flood
vector, (b) a way to spam a single address, and (c) a way to use GC's verified sender to email many
arbitrary third parties — plus the "re-issue resets `attempts=0`" hole (unbounded verify guesses across
re-issues). The Turnstile keys + `verifyTurnstile` helper already exist (`/login` uses them), so this
needs **no new founder provisioning** and is fully testable locally.

## Scope

**In (three app-layer defenses on `request-otp`):**
1. **Turnstile on the portal identity form** — the shared `identity` stage in `portal-flow.tsx` renders
   `<Turnstile siteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}>`; its token is sent in the `request-otp` body;
   the route calls `verifyTurnstile(token)` (`@/lib/turnstile`, server-side, `TURNSTILE_SECRET_KEY`)
   before any issuance → `403` on failure. Stops scripted abuse (human challenge per request).
2. **Per-`(link_id, email)` cap** — count `portal_otps` for that pair created in the last hour; ≥ **5**
   → `429`. Bounds same-address spam and the attempts-reset hole (≤ 25 guesses/hr vs a 1,000,000 space).
3. **Per-`link_id` cap** — count `portal_otps` for the link created in the last hour; ≥ **20** → `429`.
   Bounds using one link to email many different addresses (the "arbitrary third parties" vector).
Both caps are cheap count queries on `portal_otps` (already indexed by `link_id`) — **no new table**.
Client: the identity form shows the Turnstile widget and maps `403` → "verification failed, try again"
and `429` → "too many requests, try again later" (copy in `PORTAL_COPY`).

**Out (seams / infra):**
- **Per-IP + global endpoint rate limiting** — a **network-layer** concern; the right tool is **Vercel
  Firewall / WAF rate-limit rules** on `/api/portal/*`. Recommended as an infra follow-up (documented),
  **not app code** in this slice.
- Notify, GC pre-warm, etc. — unrelated, unchanged.

## Key decisions

- **Three layers, defense-in-depth.** Turnstile (bots) + per-(link,email) (same-address) + per-link
  (many-address). Founder-confirmed.
- **Thresholds:** 5 / (link,email) / hr; 20 / link / hr — generous for legit use (one endpoint or
  prospect entering their email + a few resends), tight enough to kill mass abuse.
- **Reuse `/login`'s Turnstile** helper + env (no new deps, no new provisioning).
- **No invalidate-prior-OTP** — `verify-otp` already only selects the newest unconsumed code, so older
  ones are already dead; the issuance caps bound the rest.
- **No Turnstile on `verify-otp`** — already gated by the code + attempt cap.
- **App-layer only for what app code can do well; WAF for per-IP/global** — stated honestly rather than
  pretending the app rate-limits the network.

## Data flow (`request-otp`)
```
parse body (now incl. turnstileToken)  → 400 on invalid
verifyTurnstile(turnstileToken)        → 403 on fail            (before any DB work beyond parse)
resolve link by token hash             → 404 on missing/expired/revoked
count portal_otps (link_id, email, last 1h) ≥ 5   → 429
count portal_otps (link_id, last 1h)        ≥ 20  → 429
...existing: room_viewed (once) + create OTP + sendOtpEmail + otp_sent...
```

## Verification

- **Manual (runnable locally — no CloudFront/Resend needed for the gate logic):** the identity form
  shows a Turnstile challenge; a request with a missing/invalid token → 403; passing it proceeds; the
  6th code for one (link,email) within an hour → 429; the 21st code for one link within an hour → 429.
- `typecheck` / `lint` / `build` green; `leak-check` (secret stays server-side; only the public site key
  is client-side, as on `/login`).
- No new automated test (the caps are DB-count queries and Turnstile is a network call — same
  no-unit-test posture as the other portal routes; covered by manual + typecheck).

## Seams / follow-up

- **Vercel Firewall/WAF** per-IP + global rate limit on `/api/portal/*` — infra, documented in
  `docs/infra/asset-portal-setup.md`.
- If abuse patterns emerge, the per-link/per-email windows + thresholds are single-constant tweaks.

## Dependency & branching

Stacked on `portal-3-glacier-restoring` (→ #15 → #14 → #13). Merges as part of the portal stack, before
go-live. No migration; no new env.
