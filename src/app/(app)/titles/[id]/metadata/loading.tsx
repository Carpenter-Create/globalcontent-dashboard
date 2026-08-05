import { CardListSkeleton } from "@/components/layout/page-skeletons";

// Instant feedback on navigate, and — just as importantly — this is what lets
// Next.js prefetch this dynamic route at all.
export default function Loading() {
  return <CardListSkeleton cards={3} />;
}
