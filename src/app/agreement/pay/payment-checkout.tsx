"use client";

import { useCallback, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// Appearance from tokens.css — read the live CSS vars, no hardcoded hex (PAY1, design-system).
function tokenAppearance(): Appearance {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim() || undefined;
  return {
    variables: {
      colorPrimary: v("--accent"),
      colorText: v("--text"),
      colorTextSecondary: v("--text-secondary"),
      colorBackground: v("--surface"),
      borderRadius: v("--radius-sm"),
      fontFamily: v("--font-sans"),
    },
  };
}

export function PaymentCheckout() {
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      clientSecret?: string;
      error?: string;
    };
    if (!res.ok || !data.clientSecret) {
      throw new Error(data.error || "Could not start checkout. Please try again.");
    }
    return data.clientSecret;
  }, []);
  const clientSecret = useMemo(() => fetchClientSecret(), [fetchClientSecret]);

  // Client-only (getComputedStyle needs the DOM); lazy initializer avoids a setState-in-effect
  // and any hydration mismatch (appearance configures Stripe's iframe, it isn't rendered to HTML).
  const [appearance] = useState<Appearance>(() =>
    typeof document === "undefined" ? {} : tokenAppearance(),
  );

  return (
    <CheckoutElementsProvider
      stripe={stripePromise}
      options={{ clientSecret, elementsOptions: { appearance } }}
    >
      <PayForm />
    </CheckoutElementsProvider>
  );
}

function PayForm() {
  const result = useCheckoutElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (result.type === "loading") {
    return <p className="t-body-sm text-ink-3">Loading payment…</p>;
  }
  if (result.type === "error") {
    return <InlineNotice tone="error">{result.error.message}</InlineNotice>;
  }
  const { checkout } = result;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const r = await checkout.confirm(); // session's return_url → /agreement/complete
    if (r.type === "error") {
      setError(r.error.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Processing…" : "Subscribe"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <p className="t-body-sm text-ink-3">Powered by Stripe.</p>
    </form>
  );
}
