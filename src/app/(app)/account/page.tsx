import { SETTINGS } from "@/lib/settings";
import { HashRedirect } from "@/components/chrome/hash-redirect";

// Old door. Profile now lives on /settings#profile.
export default function AccountPage() {
  return <HashRedirect href={SETTINGS.profileHref} />;
}
