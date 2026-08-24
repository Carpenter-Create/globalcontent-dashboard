import { HouseEmpty } from "@/components/chrome/house";
import { REFER } from "@/lib/refer";
import { SETTINGS } from "@/lib/settings";

// 600:881 — /settings/refer only. House empty. Do not invent a
// referral product. The 220 rail lives in the Access slot (AppShell).
export default function SettingsReferPage() {
  return (
    <div data-settings-page="" className="flex flex-col gap-[var(--space-12)]">
      <section data-settings-section="refer" className="flex flex-col gap-[var(--space-6)]">
        <h2 className="t-section text-ink">{SETTINGS.refer}</h2>
        <HouseEmpty>{REFER.empty}</HouseEmpty>
      </section>
    </div>
  );
}
