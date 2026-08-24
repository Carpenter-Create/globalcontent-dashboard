import { redirect } from "next/navigation";

import { REFER } from "@/lib/refer";

// Old door. Refer a friend now lives on /settings/refer as a house empty.
export default function ReferPage() {
  redirect(REFER.href);
}
