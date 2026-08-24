import { redirect } from "next/navigation";

import { SETTINGS } from "@/lib/settings";

// Old door. Profile lives on /settings/profile.
export default function SettingsPage() {
  redirect(SETTINGS.profileHref);
}
