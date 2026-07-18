import "server-only";
import Stripe from "stripe";

// Server-only Stripe client. Secret key never reaches the browser (leak-check).
// .trim() defends against a stray newline/space in the pasted env value.
export const stripe = new Stripe((process.env.STRIPE_SECRET_KEY ?? "").trim());
