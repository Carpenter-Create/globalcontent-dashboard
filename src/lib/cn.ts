import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge conditional class lists, with later Tailwind utilities winning conflicts.
// Lets primitives expose an overridable `className` without specificity surprises.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
