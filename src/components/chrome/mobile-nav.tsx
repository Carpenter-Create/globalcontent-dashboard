"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { MOBILE_NAV, isClientNavActive, mobileNavDestinations } from "@/lib/nav";
import { cn } from "@/lib/cn";

// Phone menu: lucide Menu 16 / 1.33 / tertiary opens a full-bleed opaque sheet
// that pops up from the bottom. Client destinations only unless isGcStaff —
// staff get NAV + GC_NAV. Hidden at md, where the desktop rail stays.
// Destination clicks close the sheet; do not sync open-state from pathname
// in an effect. Portal to document.body so the header's backdrop-blur does
// not become the fixed containing block (that left the page showing through).
export function MobileNav({ isGcStaff = false }: { isGcStaff?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const sheet = open ? (
    <MobileNavSheet
      pathname={pathname}
      onClose={() => setOpen(false)}
      isGcStaff={isGcStaff}
    />
  ) : null;

  return (
    <>
      <button
        type="button"
        data-mobile-nav-trigger=""
        aria-label={MOBILE_NAV.open}
        aria-expanded={open}
        aria-controls="mobile-nav-sheet"
        onClick={() => setOpen(true)}
        className="flex size-4 shrink-0 items-center justify-center text-ink-3 md:hidden"
      >
        <Menu className="size-4" strokeWidth={1.33} />
      </button>
      {sheet && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet}
    </>
  );
}

export function MobileNavSheet({
  pathname,
  onClose,
  isGcStaff = false,
}: {
  pathname: string;
  onClose: () => void;
  isGcStaff?: boolean;
}) {
  const destinations = mobileNavDestinations(isGcStaff);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      id="mobile-nav-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={MOBILE_NAV.sheet}
      data-mobile-nav-sheet=""
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col gap-[var(--space-6)] bg-canvas px-[var(--space-6)] py-[var(--space-12)] md:hidden"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Close mark stays lucide X 16 / 1.33 / tertiary. The button box is
          44×44 so the first tap lands. */}
      <button
        type="button"
        data-mobile-nav-close=""
        aria-label={MOBILE_NAV.close}
        onClick={onClose}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-3"
      >
        <X className="size-4" strokeWidth={1.33} />
      </button>
      <nav className="flex flex-col gap-[var(--space-2)]" data-mobile-nav-destinations="">
        {destinations.map((item) => {
          const active = isClientNavActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "w-full rounded-[var(--radius-lg)] p-[var(--space-4)] t-body text-ink",
                active ? "bg-surface-muted" : "hover:bg-surface-muted",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
