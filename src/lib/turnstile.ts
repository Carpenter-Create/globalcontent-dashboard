import "server-only";

// Server-side Cloudflare Turnstile verification. This is queue hygiene for the open,
// uncarded free-tier signup path (domain-spec §23) — NOT the security boundary; §3's
// manual contract review is what gates access. Secret key is server-only.
export async function verifyTurnstile(token: string | null): Promise<boolean> {
  if (!token) return false;

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set");
    return false;
  }

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token }),
      },
    );
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error(`[turnstile] verify failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
