import { GcShell } from "@/components/chrome/gc-shell";

// Route group `(gc)` — no URL segment, so these render at top level (/queue, /vendors) while
// still going through the shared GC shell + gc_staff gate.
export default function GcGroupLayout({ children }: { children: React.ReactNode }) {
  return <GcShell>{children}</GcShell>;
}
