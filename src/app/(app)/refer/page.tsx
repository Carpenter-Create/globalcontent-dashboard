import { PageHeader } from "@/components/ui/page-header";
import { HouseEmpty } from "@/components/chrome/house";
import { REFER } from "@/lib/refer";

// House empty. Door only — do not invent a referral product.
export default function ReferPage() {
  return (
    <>
      <PageHeader title={REFER.title} />
      <HouseEmpty>{REFER.empty}</HouseEmpty>
    </>
  );
}
