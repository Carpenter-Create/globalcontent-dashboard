import { redirect } from "next/navigation";

import { SETTINGS } from "@/lib/settings";

// Old door. Profile now lives on /settings/profile.
export default function AccountPage() {
  redirect(SETTINGS.profileHref);
}
