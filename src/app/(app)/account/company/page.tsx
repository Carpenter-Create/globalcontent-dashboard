import { redirect } from "next/navigation";

import { SETTINGS } from "@/lib/settings";

// Old door. Company now lives on /settings/profile under the user card.
export default function CompanyProfilePage() {
  redirect(SETTINGS.profileHref);
}
