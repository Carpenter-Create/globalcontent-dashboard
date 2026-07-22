import { GcShell } from "@/components/chrome/gc-shell";

// The remaining /gc/* operator routes (deliveries, titles, review, findings) render through
// the same shared GC shell + gate as the top-level /queue and /vendors routes.
export default function GcLayout({ children }: { children: React.ReactNode }) {
  return <GcShell>{children}</GcShell>;
}
