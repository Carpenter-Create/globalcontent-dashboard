"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { MOBILE_NAV, NAV, clientNavCurrent, isClientNavActive } from "@/lib/nav";
import { cn } from "@/lib/cn";

// Phone menu: lucide Menu 16 / 1.33 / tertiary opens a full-canvas sheet that
// pops up from the bottom. Client destinations only — never staff items.
// Hidden at md, where the desktop rail stays. Destination clicks close the
// sheet; do not sync open-state from pathname in an effect.
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
      {open ? <MobileNavSheet pathname={pathname} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function MobileNavSheet({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose: () => void;
}) {
  const current = clientNavCurrent(pathname);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Tailwind `md` / tokens.css phone cut — CSS `md:hidden` alone would leave
    // `open` true and body overflow locked after a phone → desktop resize.
    const mq = window.matchMedia("(min-width: 768px)");
    const onDesktop = () => {
      if (mq.matches) onClose();
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onDesktop);
    onDesktop();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onDesktop);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Portal out of the sticky `backdrop-blur` header. That filter is the
  // containing block for `position: fixed`, so an in-header sheet would
  // size to `--header-height` (56px) instead of the viewport.
  const sheet = (
    <div
      id="mobile-nav-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={current.label}
      data-mobile-nav-sheet=""
      className="fixed inset-x-0 bottom-0 top-0 z-50 flex flex-col gap-[var(--space-6)] bg-canvas px-[var(--space-6)] py-[var(--space-12)] md:hidden"
    >
      <button
        type="button"
        data-mobile-nav-close=""
        aria-label={MOBILE_NAV.close}
        onClick={onClose}
        className="flex size-4 items-center justify-center text-ink-3"
      >
        <X className="size-4" strokeWidth={1.33} />
      </button>
      <p className="t-section text-ink">{current.label}</p>
      <nav className="flex flex-col gap-[var(--space-2)]" data-mobile-nav-destinations="">
        {NAV.map((item) => {
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

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
