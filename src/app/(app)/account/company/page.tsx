import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { COMPANY_PROFILE } from "@/lib/account-profile";
import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { CompanyProfileForm } from "../company-profile-form";

export default async function CompanyProfilePage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrg) redirect("/");

  const supabase = await createClient();
  const { data: canEdit } = await supabase.rpc("member_can", {
    p_uid: ctx.user.id,
    p_org: ctx.activeOrg.id,
    p_capability: "manage_settings",
  });

  return (
    <>
      <PageHeader title={COMPANY_PROFILE.title} subtitle={COMPANY_PROFILE.subtitle} />
      <Card>
        <CardBody>
          <CompanyProfileForm
            orgId={ctx.activeOrg.id}
            name={ctx.activeOrg.name}
            canEdit={canEdit === true}
          />
        </CardBody>
      </Card>
    </>
  );
}
