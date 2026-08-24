import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { APPEARANCE } from "@/lib/appearance";
import { getOrgContext } from "@/lib/supabase/context";
import { AppearanceForm } from "./appearance-form";

export default async function AppearancePage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  return (
    <>
      <PageHeader title={APPEARANCE.title} subtitle={APPEARANCE.subtitle} />
      <Card>
        <CardBody>
          <AppearanceForm />
        </CardBody>
      </Card>
    </>
  );
}
