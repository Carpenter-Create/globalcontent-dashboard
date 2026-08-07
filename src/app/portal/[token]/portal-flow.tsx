"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PORTAL_COPY } from "@/lib/portal";
import type { BuyerActions } from "@/lib/buyer-page";
import { TitlePage } from "./title-page";

type Stage = "identity" | "code" | "ready";

// What renders once identity + code are verified. Both portal link `purpose`s share the
// same identity→code gate below; only the post-verification stage differs — this is the
// seam Task 5 branches on rather than duplicating the gate in a second component.
//
// The screener variant carries more than ScreenerRoom currently reads (catalogId, metadata,
// posterUrl, bannerUrl, trailerUrl, actions) — that's deliberate. Task 7 (this file's
// page.tsx) loads it; TitlePage (title-page.tsx) is the consumer that renders the rest.
// trailerUrl is signed the same way as posterUrl/bannerUrl (see page.tsx) — the trailer is
// promotional material, same sensitivity class as artwork, not gated behind the OTP session
// like the screener/master.
//
// Deliberately NO recipientName field. The link's recipient_name is the client's own internal
// tracking label ("tubi - dave") — it must never reach the buyer's browser at all, so it is
// not read out of the DB row into this payload in the first place (page.tsx never selects it
// into `ready`). `company`, passed alongside `ready` to TitlePage, is what actually renders —
// the buyer's own typed input at the identity gate, not this link's internal label.
export type ReadyView =
  | { mode: "download"; filename: string; bytes: number }
  | {
      mode: "screener";
      title: string;
      catalogId: string | null;
      synopsis: string | null;
      runtimeMinutes: number | null;
      metadata: Record<string, unknown>;
      posterUrl: string | null;
      bannerUrl: string | null;
      trailerUrl: string | null;
      actions: BuyerActions;
    };

// Three-stage account-less flow: capture identity → verify emailed OTP → ready (download or
// screener, per `ready.mode`). No client-side Supabase call — the /api/portal/* routes own
// every check (link validity, OTP, session) against the service-role admin client. This
// component only drives stage transitions and surfaces the real error text.
export function PortalFlow({
  token,
  ready,
}: {
  token: string;
  ready: ReadyView;
}) {
  const [stage, setStage] = useState<Stage>("identity");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, company, email, turnstileToken }),
    });
    setBusy(false);
    if (!r.ok) {
      // A Turnstile token is single-use (spent once verifyTurnstile redeems it). Any failure —
      // including a 429 that never reached Cloudflare — must force a fresh challenge, or the
      // retry reuses the dead token and misleadingly reports "verification failed".
      turnstileRef.current?.reset();
      setTurnstileToken("");
      if (r.status === 403) return setError(PORTAL_COPY.errorChallenge);
      if (r.status === 429) return setError(PORTAL_COPY.errorTooManyRequests);
      return setError(PORTAL_COPY.errorExpired);
    }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, email, code }),
    });
    setBusy(false);
    if (r.status === 429) return setError(PORTAL_COPY.errorTooMany);
    // 404 = the link itself was revoked/expired mid-flow → a new code won't help; say so.
    if (r.status === 404) return setError(PORTAL_COPY.errorExpired);
    if (!r.ok) return setError(PORTAL_COPY.errorBadCode);
    setStage("ready");
  }

  async function download() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal/download", { method: "POST" });
    setBusy(false);
    if (r.status === 409) return setError(PORTAL_COPY.errorPreparing);
    if (!r.ok) return setError(PORTAL_COPY.errorExpired);
    const { url } = await r.json();
    window.location.href = url;
  }

  // The title page is the two-column "utility meets film aesthetic" layout (viewing and
  // metadata carry equal weight — see title-page.tsx) and needs the full width the portal
  // layout grants (portal/layout.tsx), not the narrow centered card every other stage below
  // uses. It also owns its own error surface, since its actions (watch, three downloads)
  // outnumber the single error slot the card stages share.
  if (stage === "ready" && ready.mode === "screener") {
    // `company` is what the "Prepared for" line renders — `ready` carries no recipient-name
    // field at all (see ReadyView above): the link's recipient_name is the CLIENT's own
    // internal tracking label ("tubi - dave", "Roku (2nd attempt)") and must never reach an
    // external buyer. `company` is what the buyer themselves just typed at the identity gate —
    // already local state here, already required, so no extra query is needed.
    return <TitlePage ready={ready} company={company} />;
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardBody>
        <h1 className="t-subhead text-ink mb-1">
          {ready.mode === "screener" ? PORTAL_COPY.screenerHeading : PORTAL_COPY.roomTitle}
        </h1>
        {error && (
          <InlineNotice tone="error" className="mt-3">
            {error}
          </InlineNotice>
        )}

        {stage === "identity" && (
          <form onSubmit={requestOtp} className="flex flex-col gap-3 mt-3">
            <p className="t-body-sm text-ink-2">
              {ready.mode === "screener" ? PORTAL_COPY.screenerIntro : PORTAL_COPY.roomIntro}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="portal-name">Name</Label>
              <Input
                id="portal-name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="portal-company">Company</Label>
              <Input
                id="portal-company"
                autoComplete="organization"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="portal-email">Email</Label>
              <Input
                id="portal-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Turnstile
              ref={turnstileRef}
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
              onSuccess={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
            <Button type="submit" disabled={busy || !turnstileToken} className="w-full">
              {PORTAL_COPY.identitySubmit}
            </Button>
          </form>
        )}

        {stage === "code" && (
          <form onSubmit={verify} className="flex flex-col gap-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.codePrompt}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="portal-code">Code</Label>
              <Input
                id="portal-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {PORTAL_COPY.codeSubmit}
            </Button>
          </form>
        )}

        {stage === "ready" && ready.mode === "download" && (
          <div className="flex flex-col gap-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.downloadPrompt}</p>
            <p className="t-body-sm text-ink-3">
              {ready.filename} · {(ready.bytes / 1e9).toFixed(2)} GB
            </p>
            <Button onClick={download} disabled={busy} className="w-full">
              {PORTAL_COPY.downloadButton}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
