"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";

import { AppearanceCheck } from "./appearance-check";
import { useThemePreference } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import {
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_FOOTER_CLASS,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_SCROLL_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
  ACCOUNT_SHEET_VERSION_CLASS,
  accountSheetIdentity,
  destinationClickClosesSheet,
} from "@/lib/account-sheet";
import { APPEARANCE, APPEARANCE_OPTIONS, type AccountMenuFace } from "@/lib/appearance";
import { APP_SHEET_SCRIM_CLASS, SHEET_GROUP_CHEVRON_CLASS } from "@/lib/house-sheet";
import { applyDocumentThemePreference } from "@/lib/theme";
import { USER_MENU, userMenuAvatarInitial, userMenuVersion } from "@/lib/user-menu";
import { MenuSurfaceAccent } from "./menu-surface";
import {
  AppSheetHairline,
  Close44,
  IdentityBlock,
  SheetGroup,
  SheetGroupItem,
  TextAction,
} from "./house";

function AccountRowChevron() {
  return <ChevronRight className={SHEET_GROUP_CHEVRON_CLASS} strokeWidth={1.33} />;
}

function AccountMenuTrigger({
  email,
  open,
  onOpen,
  className,
  triggerAttr,
}: {
  email: string;
  open: boolean;
  onOpen: () => void;
  className: string;
  triggerAttr: "data-account-sheet-trigger" | "data-user-menu-trigger";
}) {
  const initial = userMenuAvatarInitial(email);
  const attrs = { [triggerAttr]: "" } as Record<string, string>;

  return (
    <button
      type="button"
      {...attrs}
      aria-label={ACCOUNT_SHEET.sheet}
      aria-expanded={open}
      aria-controls="account-sheet"
      onClick={onOpen}
      className={className}
    >
      {initial}
    </button>
  );
}

function useAccountMenuOpen() {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  return {
    pathname,
    open,
    openMenu: () => setOpenedOn(pathname),
    closeMenu: () => setOpenedOn(null),
  };
}

// Mobile 544:561 — avatar opens this sheet. Hamburger stays the nav sheet.
// Same Identity body as desktop 569:639. Quiet scrim; page stays under.
// One top row: Identity 48 + Close/44. Hairline — USER_MENU_ACTIONS.
// Appearance opens the second face. Log out, Legal, and version are pinned.
export function MobileAccountMenu({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const { pathname, open, openMenu, closeMenu } = useAccountMenuOpen();

  const sheet = open ? (
    <AccountSheet email={email} name={name} pathname={pathname} onClose={closeMenu} />
  ) : null;

  return (
    <>
      <AccountMenuTrigger
        email={email}
        open={open}
        onOpen={openMenu}
        triggerAttr="data-account-sheet-trigger"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 md:hidden"
      />
      {sheet && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet}
    </>
  );
}

// Desktop 569:639 — same items as mobile. Fuller panel, not the old short list.
export function DesktopAccountMenu({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const { pathname, open, openMenu, closeMenu } = useAccountMenuOpen();

  const sheet = open ? (
    <AccountSheet email={email} name={name} pathname={pathname} onClose={closeMenu} />
  ) : null;

  return (
    <div className="hidden md:block" data-user-menu-desktop="">
      <AccountMenuTrigger
        email={email}
        open={open}
        onOpen={openMenu}
        triggerAttr="data-user-menu-trigger"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink"
      />
      {sheet && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet}
    </div>
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
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col justify-end md:flex-row md:justify-end md:items-end"
    >
      <button
        type="button"
        data-account-sheet-scrim=""
        aria-label={ACCOUNT_SHEET.close}
        onClick={onClose}
        className={APP_SHEET_SCRIM_CLASS}
      />
      <div data-account-sheet-surface="" className={ACCOUNT_SHEET_SURFACE_CLASS}>
        {face === "main" ? <MenuSurfaceAccent /> : null}
        <div data-account-sheet-head="" className={ACCOUNT_SHEET_HEAD_CLASS}>
          <IdentityBlock
            avatarInitial={identity.avatarInitial}
            name={identity.name}
            email={identity.email}
          />
          <Close44
            label={ACCOUNT_SHEET.close}
            data-account-sheet-close=""
            onClick={onClose}
          />
        </div>
        {face === "appearance" ? (
          <AccountSheetAppearance onBack={() => setFace("main")} />
        ) : (
          <>
            <AppSheetHairline data-account-sheet-rule="" />
            <div data-account-sheet-scroll="" className={ACCOUNT_SHEET_SCROLL_CLASS}>
              <SheetGroup>
                {ACCOUNT_SHEET_ITEMS.map((item) => {
                  if (item.kind === "appearance") {
                    return (
                      <SheetGroupItem
                        key={item.kind}
                        item={item.kind}
                        onClick={() => setFace("appearance")}
                      >
                        {item.label}
                        <AccountRowChevron />
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
                      <AccountRowChevron />
                    </SheetGroupItem>
                  );
                })}
              </SheetGroup>
            </div>
            <AppSheetHairline data-account-sheet-logout-rule="" />
            <button
              type="button"
              data-sheet-group-item="logOut"
              data-user-menu-item="logOut"
              className={ACCOUNT_SHEET_LOGOUT_CLASS}
              onClick={() => {
                onClose();
                void signOut();
              }}
            >
              <LogOut className="size-4 shrink-0" strokeWidth={1.33} />
              {USER_MENU.logOut}
            </button>
            <AppSheetHairline data-account-sheet-footer-rule="" />
            <div data-account-sheet-footer="" className={ACCOUNT_SHEET_FOOTER_CLASS}>
              <p data-account-sheet-version="" className={ACCOUNT_SHEET_VERSION_CLASS}>
                {userMenuVersion()}
              </p>
              <TextAction href={USER_MENU.legalHref} target="_blank" rel="noopener" data-account-sheet-legal="">
                {USER_MENU.legal}
              </TextAction>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
