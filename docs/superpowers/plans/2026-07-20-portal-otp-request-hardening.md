# Portal OTP-request hardening — Implementation Plan

**Goal:** Add three app-layer defenses to `/api/portal/request-otp` — Turnstile + per-(link,email) 5/hr + per-link 20/hr caps — plus the Turnstile widget on the portal identity form and 403/429 client handling.

**Branch:** `portal-otp-turnstile-gate`, stacked on `portal-3-glacier-restoring`. No migration, no new env/deps (reuses `/login`'s Turnstile). Execute inline (small slice); whole-branch review + PR at end.

## Global Constraints
- pnpm. Rule 10 (verify server-side). Secret stays server-only (`TURNSTILE_SECRET_KEY`); only `NEXT_PUBLIC_TURNSTILE_SITE_KEY` client-side. Copy in `PORTAL_COPY`; no banned words. No new table/migration.

## Steps

- [ ] **1 — copy:** add to `PORTAL_COPY` (`src/lib/portal.ts`): `errorChallenge: "Verification failed. Please try the challenge again."`, `errorTooManyRequests: "Too many requests. Please try again later."`. Add a `PORTAL.otpPerEmailPerHour = 5`, `PORTAL.otpPerLinkPerHour = 20` to the `PORTAL` const.

- [ ] **2 — request-otp route** (`src/app/api/portal/request-otp/route.ts`): add `turnstileToken: z.string().min(1)` to the zod body. After parse, before the link lookup: `if (!(await verifyTurnstile(turnstileToken))) return 403 { error: "Verification failed" }` (import `verifyTurnstile` from `@/lib/turnstile`). After the link is validated, before issuing the OTP, run two count checks via the admin client:
```ts
const sinceIso = new Date(Date.now() - 3_600_000).toISOString();
const { count: perEmail } = await admin.from("portal_otps")
  .select("id", { count: "exact", head: true })
  .eq("link_id", link.id).eq("email", email).gte("created_at", sinceIso);
if ((perEmail ?? 0) >= PORTAL.otpPerEmailPerHour)
  return NextResponse.json({ error: "Too many requests" }, { status: 429 });
const { count: perLink } = await admin.from("portal_otps")
  .select("id", { count: "exact", head: true })
  .eq("link_id", link.id).gte("created_at", sinceIso);
if ((perLink ?? 0) >= PORTAL.otpPerLinkPerHour)
  return NextResponse.json({ error: "Too many requests" }, { status: 429 });
```
(Use the normalized `email`. Keep the existing room_viewed/create-OTP/send/otp_sent flow after.)

- [ ] **3 — identity form** (`src/app/portal/[token]/portal-flow.tsx`): import `{ Turnstile } from "@marsidev/react-turnstile"`. In the `identity` stage, render `<Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!} onSuccess={setTurnstileToken} />` (add `turnstileToken` state; disable the submit until set). Include `turnstileToken` in the `request-otp` POST body. In `requestOtp`, map `r.status === 403` → `PORTAL_COPY.errorChallenge`, `r.status === 429` → `PORTAL_COPY.errorTooManyRequests`, other `!r.ok` → `errorExpired`. Mirror `/login`'s widget usage (`src/app/login/page.tsx`).

- [ ] **4 — verify:** `pnpm typecheck && pnpm build`. Manual (local): the identity form shows a Turnstile challenge; missing token → 403; 6th code per (link,email)/hr → 429; 21st per link/hr → 429.

- [ ] **5 — infra doc:** append a note to `docs/infra/asset-portal-setup.md`: recommend **Vercel Firewall/WAF rate-limit rules** on `/api/portal/*` for per-IP/global limits (the network layer app code can't cover).

- [ ] **6 — leak-check, commit, whole-branch review (opus), PR** (stacked on `portal-3-glacier-restoring`).

## Self-review
Covers all three spec defenses + client handling + the WAF infra note. Turnstile secret stays server-side (helper already `server-only`-safe). Caps use the normalized email + the `link_id` index; no new table.
