import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { VendorForm } from "../vendor-form";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: vn } = await supabase
    .from("vendors")
    .select("id, name, delivery_mode, email_to, email_cc, email_template, company_info, export_format_spec, active")
    .eq("id", id)
    .maybeSingle();
  if (!vn) notFound(); // RLS: a non-GC user is already redirected by the (gc) layout

  return (
    <>
      <PageHeader title={vn.name} subtitle="Edit vendor" backLink={{ href: "/gc/vendors", label: "Vendors" }} />
      <VendorForm
        initial={{
          id: vn.id,
          name: vn.name,
          deliveryMode: vn.delivery_mode,
          emailTo: (vn.email_to ?? []).join(", "),
          emailCc: (vn.email_cc ?? []).join(", "),
          emailTemplate: vn.email_template ?? "",
          companyInfoJson: vn.company_info ? JSON.stringify(vn.company_info, null, 2) : "",
          exportSpecJson: vn.export_format_spec ? JSON.stringify(vn.export_format_spec, null, 2) : "",
          active: vn.active,
        }}
      />
    </>
  );
}
