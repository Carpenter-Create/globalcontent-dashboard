"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

// Debounced, URL-driven search (Visual/Metadata registers). Writes ?q= (preserving
// other params) via router.replace so the server re-renders filtered results — no
// client-side filtering, no scroll jump.
export function SearchField({ placeholder = "Search titles..." }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      const trimmed = value.trim();
      if (trimmed) sp.set("q", trimmed);
      else sp.delete("q");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(id);
    // Only re-run when the typed value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-ink-3" strokeWidth={1.5} />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search titles"
        className="h-8 w-44 rounded-full border border-hairline bg-surface pl-8 pr-3 t-body-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none sm:w-56"
      />
    </label>
  );
}
