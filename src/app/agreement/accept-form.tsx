"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { acceptAgreement } from "./actions";

// Clickwrap: an UNCHECKED checkbox (never browsewrap), submit disabled until checked (§5).
export function AcceptForm({ tier, needsPayment }: { tier: string; needsPayment: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={acceptAgreement} onSubmit={() => setSubmitting(true)} className="flex flex-col gap-4">
      <input type="hidden" name="tier" value={tier} />
      <label className="flex items-start gap-2.5 t-body-sm text-ink-2">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 accent-[var(--accent)]"
        />
        <span>
          I have read and agree to the Global Content Content Distribution Agreement shown above.
        </span>
      </label>
      <Button type="submit" disabled={!agreed || submitting} className="self-start">
        {submitting ? "…" : needsPayment ? "Accept & continue to payment" : "Accept & continue"}
      </Button>
    </form>
  );
}
