"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/actions";
import { ACCOUNT_SHEET, ACCOUNT_SHEET_ITEMS, accountSheetIdentity, destinationClickClosesSheet } from "@/lib/account-sheet";
import { APP_SHEET_SCRIM_CLASS } from "@/lib/house-sheet";
import { userMenuAvatarInitial } from "@/lib/user-menu";
import {
  AppSheetHairline,
  AppSheetHead,
  AppSheetSurface,
  Close44,
  IdentityBlock,
  SheetGroup,
  SheetGroupItem,
} from "./house";

// Phone 544:561 — avatar opens this sheet. Hamburger stays the nav sheet.
// Same app-sheet chrome as nav (543:576), account body. Quiet scrim; page stays under.
// Identity (avatar, name, email) — hairline — USER_MENU_ACTIONS. Appearance
// is a door to /account/appearance, not an inline toggle.
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

  const sheet = open ? (
    <AccountSheet email={email} name={name} pathname={pathname} onClose={() => setOpenedOn(null)} />
  ) : null;

  return (
    <>
      <button
        type="button"
        data-account-sheet-trigger=""
        aria-label={ACCOUNT_SHEET.sheet}
        aria-expanded={open}
        aria-controls="account-sheet"
        onClick={() => setOpenedOn(pathname)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 md:hidden"
      >
        {initial}
      </button>
      {sheet && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet}
    </>
  );
}

export function AccountSheet({
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
  const identity = accountSheetIdentity(email, name);

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
      id="account-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={ACCOUNT_SHEET.sheet}
      data-account-sheet=""
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col justify-end md:hidden"
    >
      <button
        type="button"
        data-account-sheet-scrim=""
        aria-label={ACCOUNT_SHEET.close}
        onClick={onClose}
        className={APP_SHEET_SCRIM_CLASS}
      />
      <AppSheetSurface data-account-sheet-surface="" className="relative z-10">
        <AppSheetHead data-account-sheet-head="" className="justify-end">
          <Close44
            label={ACCOUNT_SHEET.close}
            data-account-sheet-close=""
            onClick={onClose}
          />
        </AppSheetHead>
        <IdentityBlock
          avatarInitial={identity.avatarInitial}
          name={identity.name}
          email={identity.email}
        />
        <AppSheetHairline data-account-sheet-rule="" />
        <SheetGroup>
          {ACCOUNT_SHEET_ITEMS.map((item) => {
            if (item.kind === "logOut") {
              return (
                <SheetGroupItem
                  key={item.kind}
                  item={item.kind}
                  onClick={() => {
                    onClose();
                    void signOut();
                  }}
                >
                  {item.label}
                </SheetGroupItem>
              );
            }
            return (
              <SheetGroupItem
                key={item.kind}
                item={item.kind}
                href={item.href}
                onClick={
                  destinationClickClosesSheet(pathname, item.href) ? onClose : undefined
                }
              >
                {item.label}
              </SheetGroupItem>
            );
          })}
        </SheetGroup>
      </AppSheetSurface>
    </div>
  );
}
