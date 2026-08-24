import { redirect } from "next/navigation";

import { SETTINGS } from "@/lib/settings";

// Old door. Agreements now lives on /settings/agreements as a house empty.
export default function AccountAgreementsPage() {
  redirect(SETTINGS.agreementsHref);
}
