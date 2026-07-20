"use client";

import { useState } from "react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PORTAL_COPY } from "@/lib/portal";

type Stage = "identity" | "code" | "ready";

// Three-stage account-less flow: capture identity → verify emailed OTP → download.
// No client-side Supabase call — the three /api/portal/* routes (Tasks 6-8) own
// every check (link validity, OTP, session) against the service-role admin client.
// This component only drives stage transitions and surfaces the real error text.
export function PortalFlow({
  token,
  filename,
  bytes,
}: {
  token: string;
  filename: string;
  bytes: number;
}) {
  const [stage, setStage] = useState<Stage>("identity");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, company, email }),
    });
    setBusy(false);
    if (!r.ok) return setError(PORTAL_COPY.errorExpired);
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

  return (
    <Card>
      <CardBody>
        <h1 className="t-subhead text-ink mb-1">{PORTAL_COPY.roomTitle}</h1>
        {error && (
          <InlineNotice tone="error" className="mt-3">
            {error}
          </InlineNotice>
        )}

        {stage === "identity" && (
          <form onSubmit={requestOtp} className="flex flex-col gap-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.roomIntro}</p>
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
            <Button type="submit" disabled={busy} className="w-full">
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

        {stage === "ready" && (
          <div className="flex flex-col gap-3 mt-3">
            <p className="t-body-sm text-ink-2">{PORTAL_COPY.downloadPrompt}</p>
            <p className="t-body-sm text-ink-3">
              {filename} · {(bytes / 1e9).toFixed(2)} GB
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
