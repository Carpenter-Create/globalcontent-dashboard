import "server-only";
import Stripe from "stripe";

// Server-only Stripe client. Secret key never reaches the browser (leak-check).
// Lazily instantiated: importing this module must never construct Stripe, because
// the SDK constructor throws on an empty key and pages that import `stripe` are
// evaluated at build time (before STRIPE_SECRET_KEY exists). Construction happens
// on first real use, at runtime. .trim() defends against a stray newline/space in
// the pasted env value.
let client: Stripe | null = null;

function getStripe(): Stripe {
  if (!client) {
    const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

// Proxy preserves the `stripe.checkout.sessions.create(...)` call-site shape while
// deferring construction to the first property access.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getStripe(), prop, receiver);
    return typeof value === "function" ? value.bind(getStripe()) : value;
  },
});
