"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { GC_NAV, MOBILE_NAV, NAV, isClientNavActive, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/cn";

// Phone menu: lucide Menu 16 / 1.33 / tertiary opens a full-bleed opaque sheet
// that pops up from the bottom. Client destinations only unless isGcStaff —
// staff get NAV, then a hairline + 24 gap, then GC_NAV. Hidden at md, where
// the desktop rail stays.
// Destination clicks keep the opaque portal mounted until the next route
// commits. Closing on click unmounted the overlay and the next segment painted
// a blank canvas. Same-href clicks still dismiss immediately. Portal to
// document.body so the header's backdrop-blur does not become the fixed
// containing block (that left the page showing through).
export function MobileNav({ isGcStaff = false }: { isGcStaff?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

// Same-href taps never commit a new route, so the pathname effect will not run.
export function destinationClickClosesSheet(pathname: string, href: string): boolean {
  return pathname === href;
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

  const link = (item: NavItem) => {
    const active = isClientNavActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={destinationClickClosesSheet(pathname, item.href) ? onClose : undefined}
        className={cn(
          "w-full rounded-[var(--radius-lg)] p-[var(--space-4)] t-body text-ink",
          active ? "bg-surface-muted" : "hover:bg-surface-muted",
        )}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <div
      id="mobile-nav-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={MOBILE_NAV.sheet}
      data-mobile-nav-sheet=""
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col gap-[var(--space-6)] overflow-hidden touch-none bg-canvas px-[var(--space-6)] py-[var(--space-12)] md:hidden"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Close mark stays lucide X 16 / 1.33 / tertiary. The button box is
          44×44 so the first tap lands. */}
      <button
        type="button"
        data-mobile-nav-close=""
        aria-label={MOBILE_NAV.close}
        onClick={onClose}
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-ink-3"
      >
        <X className="size-4" strokeWidth={1.33} />
      </button>
      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain touch-pan-y"
        data-mobile-nav-destinations=""
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex flex-col gap-[var(--space-2)]">{NAV.map(link)}</div>
        {isGcStaff ? (
          <>
            <div
              data-mobile-nav-group-rule=""
              className="my-[var(--space-6)] border-t border-hairline"
            />
            <div className="flex flex-col gap-[var(--space-2)]">{GC_NAV.map(link)}</div>
          </>
        ) : null}
      </nav>
    </div>
  );
}
