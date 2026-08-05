import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";

// Refreshes the auth session on every request and gates protected routes.
// Public paths: /login and /auth/* (magic-link callback). Everything else requires a session.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do NOT insert logic between client creation and this call — it refreshes the token.
  // getClaims() verifies the JWT locally (WebCrypto + cached JWKS) on asymmetric-key
  // projects instead of a network round-trip to the Auth server, and still calls
  // getSession() internally so an expired token is refreshed exactly as getUser() did.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/portal") ||       // account-less asset-access portal (token-gated)
    path.startsWith("/api/portal") ||   // portal route handlers (token/OTP/session gated in-handler)
    // Stripe webhook authenticates by signature, not a user session — must not be
    // redirected to /login (it has no cookies).
    path === "/api/stripe/webhook";
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
