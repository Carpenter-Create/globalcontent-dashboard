import { redirect } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { SETTINGS } from "@/lib/settings";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { userMenuName } from "@/lib/user-menu";
import { AccountProfileForm } from "../../account/account-profile-form";
import { CompanyProfileForm } from "../../account/company-profile-form";

// 627:818 — user card, then the existing company block on the same
// /settings/profile page. Not a second route. Not a rail row. The 220
// rail stays in the Access slot. Name and email come from the session
// only. Company persist is organizations.name. Do not invent columns.
// Do not restyle Identity or the phone header.
export default async function SettingsProfilePage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const photoUrl = await signedAvatarUrl(ctx.user.id);

  let canEditCompany = false;
  if (ctx.activeOrg) {
    const supabase = await createClient();
    const { data: canEdit } = await supabase.rpc("member_can", {
      p_uid: ctx.user.id,
      p_org: ctx.activeOrg.id,
      p_capability: "manage_settings",
    });
    canEditCompany = canEdit === true;
  }

  return (
    <div data-settings-page="" className="flex flex-col gap-[var(--space-12)]">
      <section
        data-settings-section="profile"
        className="flex flex-col gap-[var(--space-6)]"
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
      {ctx.activeOrg ? (
        <section
          data-settings-section="company"
          className="flex flex-col gap-[var(--space-6)]"
        >
          <h2 className="t-section text-ink">{SETTINGS.company}</h2>
          <Card>
            <CardBody>
              <CompanyProfileForm
                orgId={ctx.activeOrg.id}
                name={ctx.activeOrg.name}
                canEdit={canEditCompany}
              />
            </CardBody>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
