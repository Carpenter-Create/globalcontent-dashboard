import { NextResponse } from "next/server";

// TEMPORARY production latency probe — delete once the slowness is diagnosed.
// Measures, from INSIDE a Vercel function, how long the things a page render depends on
// actually take. Returns DURATIONS ONLY — never an env value.
export const dynamic = "force-dynamic";

const bootAt = Date.now();          // module init: fresh on a cold start, retained when warm
let invocations = 0;

async function sample(fn: () => Promise<unknown>, n = 5): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    try { await fn(); } catch { /* timing is the point */ }
    out.push(Math.round(performance.now() - t));
  }
  return out;
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], all: xs };
};

export async function GET() {
  invocations += 1;
  const t0 = performance.now();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "supabase env absent" }, { status: 500 });

  const rest = await sample(() =>
    fetch(`${url}/rest/v1/`, { headers: { apikey: key }, cache: "no-store" }),
  );
  const auth = await sample(() =>
    fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store" }),
  );

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? "unknown",
    // A high number here with invocations=1 means every request pays a cold start.
    coldStart: { msSinceModuleInit: Date.now() - bootAt, invocationsThisInstance: invocations },
    supabaseRestMs: stats(rest),
    supabaseAuthMs: stats(auth),
    handlerTotalMs: Math.round(performance.now() - t0),
  });
}
