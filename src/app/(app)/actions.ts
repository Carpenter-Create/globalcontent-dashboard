"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

// Active-org selection is a cookie (not server state) — the layout resolves it against
// the user's memberships, so a stale/forged cookie can only ever select an org the user
// already belongs to. RLS remains the real boundary.
export async function setActiveOrg(orgId: string) {
  (await cookies()).set("gc_active_org", orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
