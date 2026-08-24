import { SETTINGS } from "@/lib/settings";
import { HashRedirect } from "@/components/chrome/hash-redirect";

// Old door. Agreements now lives on /settings#agreements as a house empty.
export default function AccountAgreementsPage() {
  return <HashRedirect href={SETTINGS.agreementsHref} />;
}
