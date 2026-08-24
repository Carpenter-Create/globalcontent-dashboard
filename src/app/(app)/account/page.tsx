import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ACCOUNT_PROFILE } from "@/lib/account-profile";
import { getOrgContext } from "@/lib/supabase/context";
import { userMenuName } from "@/lib/user-menu";
import { AccountProfileForm } from "./account-profile-form";

export default async function AccountPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  return (
    <>
      <PageHeader title={ACCOUNT_PROFILE.title} subtitle={ACCOUNT_PROFILE.subtitle} />
      <Card>
        <CardBody>
          <AccountProfileForm name={userMenuName(ctx.user.name) ?? ""} email={ctx.user.email} />
        </CardBody>
      </Card>
    </>
  );
}
