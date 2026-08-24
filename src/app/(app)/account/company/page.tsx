import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { COMPANY_PROFILE, canEditCompanyProfile } from "@/lib/account-profile";
import { getOrgContext } from "@/lib/supabase/context";
import { CompanyProfileForm } from "../company-profile-form";

export default async function CompanyProfilePage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrg) redirect("/");

  return (
    <>
      <PageHeader title={COMPANY_PROFILE.title} subtitle={COMPANY_PROFILE.subtitle} />
      <Card>
        <CardBody>
          <CompanyProfileForm
            name={ctx.activeOrg.name}
            canEdit={canEditCompanyProfile(ctx.activeRole, ctx.isGcStaff)}
          />
        </CardBody>
      </Card>
    </>
  );
}
