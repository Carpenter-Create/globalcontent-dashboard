import { SettingsIndexRedirect } from "./settings-index-redirect";

// Old door. /settings and /settings#profile go to /settings/profile.
// /settings#agreements goes to /settings/agreements.
export default function SettingsPage() {
  return <SettingsIndexRedirect />;
}
