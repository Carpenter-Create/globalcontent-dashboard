import { redirect } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { HouseEmpty } from "@/components/chrome/house";
import { SETTINGS } from "@/lib/settings";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import { getOrgContext } from "@/lib/supabase/context";
import { userMenuName } from "@/lib/user-menu";
import { AccountProfileForm } from "../account/account-profile-form";
import { SettingsLocalNav } from "./settings-local-nav";

// 600:881 — /settings with #profile and #agreements. Name and email come
// from the session only. Photo persist is the existing avatar path.
// Agreements stays a house empty.
export default async function SettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const photoUrl = await signedAvatarUrl(ctx.user.id);

  return (
    <div
      data-settings-page=""
      className="flex flex-col gap-[var(--space-8)] md:flex-row md:items-start md:gap-[var(--space-12)]"
    >
      <div className="w-full shrink-0 md:w-[220px]">
        <SettingsLocalNav />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-12)]">
        <section
          id={SETTINGS.profileHash}
          data-settings-section="profile"
          className="flex scroll-mt-[var(--header-height)] flex-col gap-[var(--space-6)]"
        >
          <h2 className="t-section text-ink">{SETTINGS.profile}</h2>
          <Card>
            <CardBody>
              <AccountProfileForm
                name={userMenuName(ctx.user.name) ?? ""}
                email={ctx.user.email}
                photoUrl={photoUrl}
              />
            </CardBody>
          </Card>
        </section>
        <section
          id={SETTINGS.agreementsHash}
          data-settings-section="agreements"
          className="flex scroll-mt-[var(--header-height)] flex-col gap-[var(--space-6)]"
        >
          <h2 className="t-section text-ink">{SETTINGS.agreements}</h2>
          <HouseEmpty>{SETTINGS.agreementsEmpty}</HouseEmpty>
        </section>
      </div>
    </div>
  );
}
