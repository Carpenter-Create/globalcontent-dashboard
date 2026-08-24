"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

import { AppearanceCheck } from "./appearance-check";
import { useThemePreference } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import { ACCOUNT_SHEET, ACCOUNT_SHEET_ITEMS, accountSheetIdentity, destinationClickClosesSheet } from "@/lib/account-sheet";
import { APPEARANCE, APPEARANCE_OPTIONS, type AccountMenuFace } from "@/lib/appearance";
import { APP_SHEET_SCRIM_CLASS } from "@/lib/house-sheet";
import { applyDocumentThemePreference } from "@/lib/theme";
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
// opens the second face (Back to main menu + Light / Dark / Auto). Not a page.
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

export function AccountSheetAppearance({
  onBack,
}: {
  onBack: () => void;
}) {
  const preference = useThemePreference();

  return (
    <SheetGroup>
      <SheetGroupItem item="back" onClick={onBack}>
        {APPEARANCE.back}
      </SheetGroupItem>
      {APPEARANCE_OPTIONS.map((option) => (
        <SheetGroupItem
          key={option.kind}
          item={option.kind}
          pressed={preference === option.kind}
          onClick={() => {
            applyDocumentThemePreference(option.kind);
          }}
        >
          <span className="flex items-center gap-[var(--space-2)]">
            {option.label}
            <AppearanceCheck selected={preference === option.kind} />
          </span>
        </SheetGroupItem>
      ))}
    </SheetGroup>
  );
}

export function AccountSheet({
  email,
  name,
  pathname,
  onClose,
  face: initialFace = "main",
}: {
  email: string;
  name?: string | null;
  pathname: string;
  onClose: () => void;
  face?: AccountMenuFace;
}) {
  const identity = accountSheetIdentity(email, name);
  const [face, setFace] = useState<AccountMenuFace>(initialFace);

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
      data-account-menu-face={face}
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
        {face === "appearance" ? (
          <AccountSheetAppearance onBack={() => setFace("main")} />
        ) : (
          <>
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
                if (item.kind === "appearance") {
                  return (
                    <SheetGroupItem
                      key={item.kind}
                      item={item.kind}
                      onClick={() => setFace("appearance")}
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
          </>
        )}
      </AppSheetSurface>
    </div>
  );
}
