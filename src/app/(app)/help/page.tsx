import { PageHeader } from "@/components/ui/page-header";
import { HouseEmpty } from "@/components/chrome/house";
import { HELP } from "@/lib/help";

// House empty. Door only — do not invent a help product.
export default function HelpPage() {
  return (
    <>
      <PageHeader title={HELP.title} />
      <HouseEmpty>{HELP.empty}</HouseEmpty>
    </>
  );
}
