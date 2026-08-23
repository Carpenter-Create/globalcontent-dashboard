"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import {
  ACCOUNT_OVERLAY,
  ACCOUNT_OVERLAY_ITEMS,
  accountOverlayIdentity,
  destinationClickClosesOverlay,
} from "@/lib/account-overlay";
import { userMenuAvatarInitial } from "@/lib/user-menu";

// Phone 537:557 — avatar opens this overlay. Hamburger stays the nav sheet.
// Identity first, Manage account, then ACCOUNT. Not a rail dump.
export function MobileAccountMenu({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const initial = userMenuAvatarInitial(email);

  const overlay = open ? (
    <AccountOverlay email={email} name={name} pathname={pathname} onClose={() => setOpenedOn(null)} />
  ) : null;

  return (
    <>
      <button
        type="button"
        data-account-overlay-trigger=""
        aria-label={ACCOUNT_OVERLAY.sheet}
        aria-expanded={open}
        aria-controls="account-overlay"
        onClick={() => setOpenedOn(pathname)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 md:hidden"
      >
        {initial}
      </button>
      {overlay && typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay}
    </>
  );
}

export function AccountOverlay({
  email,
  name,
  pathname,
  onClose,
}: {
  email: string;
  name?: string | null;
  pathname: string;
  onClose: () => void;
}) {
  const identity = accountOverlayIdentity(email, name);

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
      id="account-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ACCOUNT_OVERLAY.sheet}
      data-account-overlay=""
      className="fixed inset-0 z-50 md:hidden"
    >
      <button
        type="button"
        data-account-overlay-scrim=""
        aria-label={ACCOUNT_OVERLAY.close}
        onClick={onClose}
        className="absolute inset-0 bg-ink/24"
      />
      <div
        data-account-overlay-surface=""
        className="absolute inset-x-0 bottom-0 top-[var(--header-height)] z-10 flex flex-col gap-[var(--space-12)] overflow-hidden bg-surface px-[var(--space-4)] pb-[var(--space-12)] pt-[var(--space-6)]"
      >
        <div data-account-overlay-head="" className="flex h-[44px] shrink-0 items-center justify-end">
          <button
            type="button"
            data-account-overlay-close=""
            aria-label={ACCOUNT_OVERLAY.close}
            onClick={onClose}
            className="flex size-[44px] min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-3"
          >
            <X className="size-4" strokeWidth={1.33} />
          </button>
        </div>
        <div data-account-overlay-identity="" className="flex flex-col items-start gap-[var(--space-4)]">
          <div
            data-account-overlay-avatar=""
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body font-normal text-ink-2"
          >
            {identity.avatarInitial}
          </div>
          <div data-account-overlay-who="" className="flex flex-col items-start gap-[var(--space-2)]">
            <p
              data-account-overlay-name=""
              className="text-[length:var(--text-title)] font-normal leading-8 text-ink"
            >
              {identity.name}
            </p>
            <p
              data-account-overlay-email=""
              className="text-[length:var(--text-base)] font-normal leading-5 text-ink-2"
            >
              {identity.email}
            </p>
          </div>
          <Link
            href={ACCOUNT_OVERLAY.manageHref}
            onClick={
              destinationClickClosesOverlay(pathname, ACCOUNT_OVERLAY.manageHref) ? onClose : undefined
            }
            data-account-overlay-manage=""
            className="t-body-sm font-normal text-accent"
          >
            {ACCOUNT_OVERLAY.manage}
          </Link>
        </div>
        <div data-account-overlay-group="" className="flex flex-col items-start gap-[var(--space-6)]">
          <p
            data-account-overlay-group-label=""
            className="text-[length:var(--text-xs)] font-normal uppercase tracking-[0.08em] text-ink-2"
          >
            {ACCOUNT_OVERLAY.group}
          </p>
          {ACCOUNT_OVERLAY_ITEMS.map((item) =>
            item.href ? (
              <Link
                key={item.kind}
                href={item.href}
                onClick={
                  destinationClickClosesOverlay(pathname, item.href) ? onClose : undefined
                }
                data-account-overlay-item={item.kind}
                className="flex h-5 items-center text-[length:var(--text-base)] font-normal leading-5 text-ink"
              >
                {item.label}
              </Link>
            ) : (
              <p
                key={item.kind}
                data-account-overlay-item={item.kind}
                className="flex h-5 items-center text-[length:var(--text-base)] font-normal leading-5 text-ink"
              >
                {item.label}
              </p>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
