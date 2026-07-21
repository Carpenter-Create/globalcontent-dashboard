import { redirect } from "next/navigation";

// GC landing → the Queue. (The gc layout gate already enforces gc_staff.)
export default function GcIndex() {
  redirect("/gc/queue");
}
