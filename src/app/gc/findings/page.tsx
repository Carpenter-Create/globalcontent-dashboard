import { redirect } from "next/navigation";

// Findings folded into the Queue (shown as a per-title flag there, and listed on each
// title's detail). This route now redirects.
export default function GcFindingsRedirect() {
  redirect("/gc/queue");
}
