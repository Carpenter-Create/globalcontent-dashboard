import "server-only";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

// Service-role client — bypasses RLS. ONLY for trusted server contexts with no user JWT
// (the Stripe webhook → finalize_paid_signup, which is granted to service_role). Server-only;
// never import into client code (leak-check enforces the key stays out of the bundle).
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
