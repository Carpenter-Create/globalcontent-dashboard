import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

// Browser (client-component) Supabase client. Anon/publishable key only — never a
// service-role key in the browser bundle (leak-check enforces this before shipping).
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
