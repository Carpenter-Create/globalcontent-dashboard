import { redirect } from "next/navigation";

// Review folded into the Queue + per-title detail (GC-operator pass). This route now
// redirects; the review components (review-controls, link-controls, screener-panel) and
// actions still live here and are imported by /gc/titles/[id].
export default function GcReviewRedirect() {
  redirect("/gc/queue");
}
