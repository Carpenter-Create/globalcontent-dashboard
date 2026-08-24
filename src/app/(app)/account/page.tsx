import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ACCOUNT_PROFILE } from "@/lib/account-profile";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import { getOrgContext } from "@/lib/supabase/context";
import { userMenuName } from "@/lib/user-menu";
import { AccountProfileForm } from "./account-profile-form";

export default async function AccountPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const photoUrl = await signedAvatarUrl(ctx.user.id);

  return (
    <>
      <PageHeader title={ACCOUNT_PROFILE.title} />
      <Card>
        <CardBody>
          <AccountProfileForm
            name={userMenuName(ctx.user.name) ?? ""}
            email={ctx.user.email}
            photoUrl={photoUrl}
          />
        </CardBody>
      </Card>
    </>
  );
}
