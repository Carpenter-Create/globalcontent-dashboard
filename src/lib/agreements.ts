import "server-only";
import { createHash } from "node:crypto";

// Agreement content lives in lib/, not JSX. PLACEHOLDER text — the binding agreement is a
// founder/counsel task (§5). Deterministic per tier+version so the server renders the exact
// text the client sees AND hashes that same text (content_hash covers the rendered text, §5).
// Parameterized-vs-per-tier is §21.13 (open); this is the parameterized shape for now.

export const TERMS_VERSION = "2026-07-placeholder";

export type Tier = "access" | "pro" | "premium";
export const TIERS: Tier[] = ["access", "pro", "premium"];

export const TIER_META: Record<
  Tier,
  { label: string; priceLabel: string; annualPriceCents: number; termMonths: number; blurb: string }
> = {
  access: {
    label: "Access",
    priceLabel: "$397 / title",
    annualPriceCents: 0,
    termMonths: 12,
    blurb: "Per-title plan. No annual Stripe price in this cycle.",
  },
  pro: {
    label: "Pro",
    priceLabel: "$797 / year",
    annualPriceCents: 79700,
    termMonths: 12,
    blurb: "For active catalogs.",
  },
  premium: {
    label: "Premium",
    priceLabel: "$1,997 / year",
    annualPriceCents: 199700,
    termMonths: 36,
    blurb: "Best rate, three-year term.",
  },
};

export function renderAgreement(tier: Tier): string {
  const m = TIER_META[tier];
  return [
    "GLOBAL CONTENT — CONTENT DISTRIBUTION AGREEMENT (PLACEHOLDER)",
    `Version: ${TERMS_VERSION}`,
    "",
    `Tier: ${m.label} (${m.priceLabel}) · Term: ${m.termMonths} months.`,
    "",
    "THIS IS PLACEHOLDER TEXT for development only. The binding agreement is drafted by",
    "counsel and replaces this in full before launch. The revenue-share rate is TBD.",
    "",
    "1. Distribution. Global Content distributes the titles you submit, within the rights",
    "   and territories you grant, across its vendor network.",
    "2. Term & renewal. This agreement runs for the term above and renews per its terms.",
    "3. Early takedown. You may withdraw a title before term expiry on payment of the",
    "   then-current takedown fee ($197 per title). Offload at/after expiry is free.",
    "4. Downgrade. You may change tier at any time via a new agreement; no downgrade fee.",
    "5. Fees & payment. Tier fees are billed as described at checkout.",
    "6. Data & provenance. Your sources are stored immutably; every derived figure is traceable.",
    "",
    "By accepting, you agree to the terms above for the selected tier.",
  ].join("\n");
}

export function hashAgreement(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex");
}
