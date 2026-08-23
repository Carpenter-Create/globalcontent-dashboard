import { PageHeader } from "@/components/ui/page-header";
import { VENDORS_PAGE } from "@/lib/vendors-directory";
import { VendorForm } from "../vendor-form";

export default function NewVendorPage() {
  return (
    <>
      <PageHeader
        title="New vendor"
        backLink={{ href: "/vendors", label: VENDORS_PAGE.title }}
      />
      <VendorForm />
    </>
  );
}
