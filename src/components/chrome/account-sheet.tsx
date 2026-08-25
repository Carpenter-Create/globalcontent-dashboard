"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";

import { AppearanceCheck } from "./appearance-check";
import { useThemePreference } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import {
  ACCOUNT_MENU_APPEARANCE_CHEVRON_CLASS,
  ACCOUNT_MENU_APPEARANCE_COPY_CLASS,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_CLASS,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_HELPER_CLASS,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_HOST_CLASS,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_MARK_CLASS,
  accountMenuAppearanceFlyoutRight,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_ROW_CLASS,
  ACCOUNT_MENU_APPEARANCE_MODE_CLASS,
  ACCOUNT_MENU_APPEARANCE_ROW_CLASS,
  ACCOUNT_MENU_APPEARANCE_WASH_CLASS,
  ACCOUNT_MENU_DROPDOWN_ALIGN,
  ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS,
  ACCOUNT_MENU_DROPDOWN_GROUP_CLASS,
  ACCOUNT_MENU_DROPDOWN_HEAD_CLASS,
  ACCOUNT_MENU_DROPDOWN_HOST_CLASS,
  ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS,
  ACCOUNT_MENU_DROPDOWN_LEFTOVER_CLASS,
  ACCOUNT_MENU_DROPDOWN_PIN_CLASS,
  ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS,
  ACCOUNT_MENU_DROPDOWN_STAGE_CLASS,
  ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS,
  ACCOUNT_SHEET_APPEARANCE_COPY_CLASS,
  accountMenuAppearanceFlyoutAlign,
  accountMenuDropdownAlignEnd,
  type AccountMenuDropdownAlign,
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_FOOTER_CLASS,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_HOST_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_LOGOUT_STACK_CLASS,
  ACCOUNT_SHEET_PIN_CLASS,
  ACCOUNT_SHEET_SCROLL_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
  ACCOUNT_SHEET_VERSION_CLASS,
  accountSheetIdentity,
  destinationClickClosesSheet,
} from "@/lib/account-sheet";
import {
  APPEARANCE,
  APPEARANCE_FLYOUT_OPTIONS,
  appearancePreferenceLabel,
  type AccountMenuFace,
} from "@/lib/appearance";
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

function AccountAppearanceChevron() {
  return (
    <span
      data-account-menu-appearance-chevron=""
      className={ACCOUNT_MENU_APPEARANCE_CHEVRON_CLASS}
    >
      <AccountRowChevron />
    </span>
  );
}

function AccountBackChevron() {
  return <ChevronLeft className={SHEET_GROUP_CHEVRON_CLASS} strokeWidth={1.33} />;
}

function AccountMenuTrigger({
  email,
  open,
  onOpen,
  className,
  triggerAttr,
  controlsId,
  triggerRef,
}: {
  email: string;
  open: boolean;
  onOpen: () => void;
  className: string;
  triggerAttr: "data-account-sheet-trigger" | "data-user-menu-trigger";
  controlsId: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const initial = userMenuAvatarInitial(email);
  const attrs = { [triggerAttr]: "" } as Record<string, string>;

  return (
    <button
      type="button"
      {...attrs}
      ref={triggerRef}
      aria-label={ACCOUNT_SHEET.sheet}
      aria-expanded={open}
      aria-controls={controlsId}
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

function useAccountMenuDismiss(onClose: () => void, lockOverflow: boolean) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    if (lockOverflow) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (lockOverflow) document.body.style.overflow = previous;
    };
  }, [onClose, lockOverflow]);
}

function useDesktopAccountMenuAlignEnd(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
) {
  const [alignEnd, setAlignEnd] = useState<AccountMenuDropdownAlign | undefined>();

  useLayoutEffect(() => {
    if (!open) return undefined;
    const sync = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setAlignEnd(
        accountMenuDropdownAlignEnd(
          trigger.getBoundingClientRect(),
          document.documentElement.clientWidth,
        ),
      );
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [open, triggerRef]);

  return alignEnd;
}

function AccountMenuFooter() {
  return (
    <div data-account-sheet-footer="" className={ACCOUNT_SHEET_FOOTER_CLASS}>
      <p data-account-sheet-version="" className={ACCOUNT_SHEET_VERSION_CLASS}>
        {userMenuVersion()}
      </p>
      <TextAction href={USER_MENU.legalHref} target="_blank" rel="noopener" data-account-sheet-legal="" className="leading-4">
        {USER_MENU.legal}
      </TextAction>
    </div>
  );
}

function AccountMenuLogOut({ onClose }: { onClose: () => void }) {
  return (
    <div data-account-sheet-logout-stack="" className={ACCOUNT_SHEET_LOGOUT_STACK_CLASS}>
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
    </div>
  );
}

function AccountMenuPin({
  onClose,
  className,
}: {
  onClose: () => void;
  className: string;
}) {
  return (
    <div data-account-sheet-pin="" className={className}>
      <AccountMenuLogOut onClose={onClose} />
      <AppSheetHairline data-account-sheet-footer-rule="" />
      <AccountMenuFooter />
    </div>
  );
}

function AccountAppearanceRow({
  open,
  onClick,
  rowRef,
}: {
  open: boolean;
  onClick: () => void;
  rowRef?: Ref<HTMLButtonElement>;
}) {
  const preference = useThemePreference();

  return (
    <button
      type="button"
      ref={rowRef}
      data-sheet-group-item="appearance"
      data-user-menu-item="appearance"
      aria-expanded={open}
      onClick={onClick}
      className={ACCOUNT_MENU_APPEARANCE_ROW_CLASS}
    >
      {open ? (
        <span data-account-menu-appearance-wash="" className={ACCOUNT_MENU_APPEARANCE_WASH_CLASS} />
      ) : null}
      <span className={ACCOUNT_MENU_APPEARANCE_COPY_CLASS}>
        <span>{USER_MENU.appearance}</span>
        <span data-account-menu-appearance-mode="" className={ACCOUNT_MENU_APPEARANCE_MODE_CLASS}>
          {appearancePreferenceLabel(preference)}
        </span>
      </span>
      <AccountAppearanceChevron />
    </button>
  );
}

export function AccountAppearanceFlyout({
  className = ACCOUNT_MENU_APPEARANCE_FLYOUT_CLASS,
  checkClassName,
}: {
  className?: string;
  checkClassName?: string;
}) {
  const preference = useThemePreference();

  return (
    <div data-account-menu-appearance-flyout="" className={className}>
      {APPEARANCE_FLYOUT_OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          data-sheet-group-item={option.kind}
          data-account-menu-appearance-option={option.kind}
          aria-pressed={preference === option.kind}
          className={ACCOUNT_MENU_APPEARANCE_FLYOUT_ROW_CLASS}
          onClick={() => {
            applyDocumentThemePreference(option.kind);
          }}
        >
          <span className={ACCOUNT_MENU_APPEARANCE_FLYOUT_MARK_CLASS}>
            <AppearanceCheck
              selected={preference === option.kind}
              className={checkClassName}
            />
          </span>
          <span className={ACCOUNT_MENU_APPEARANCE_COPY_CLASS}>
            <span>{option.label}</span>
            {"helper" in option ? (
              <span className={ACCOUNT_MENU_APPEARANCE_FLYOUT_HELPER_CLASS}>{option.helper}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Same-sheet drill-in. Replaces the list face. 618:785 overlay is void. */
export function AccountSheetAppearance({
  onBack,
}: {
  onBack: () => void;
}) {
  const preference = useThemePreference();

  return (
    <SheetGroup>
      <SheetGroupItem item="back" onClick={onBack} label={APPEARANCE.back}>
        <AccountBackChevron />
      </SheetGroupItem>
      {APPEARANCE_FLYOUT_OPTIONS.map((option) => (
        <SheetGroupItem
          key={option.kind}
          item={option.kind}
          pressed={preference === option.kind}
          onClick={() => {
            applyDocumentThemePreference(option.kind);
          }}
        >
          <span className={ACCOUNT_SHEET_APPEARANCE_COPY_CLASS}>
            <span>{option.label}</span>
            {"helper" in option ? (
              <span className={ACCOUNT_MENU_APPEARANCE_FLYOUT_HELPER_CLASS}>{option.helper}</span>
            ) : null}
          </span>
          <AppearanceCheck selected={preference === option.kind} />
        </SheetGroupItem>
      ))}
    </SheetGroup>
  );
}

function AccountMenuItems({
  pathname,
  onClose,
  face,
  onAppearance,
  appearanceRowRef,
}: {
  pathname: string;
  onClose: () => void;
  face: AccountMenuFace;
  onAppearance: () => void;
  appearanceRowRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <>
      {ACCOUNT_SHEET_ITEMS.map((item) => {
        if (item.kind === "appearance") {
          return (
            <AccountAppearanceRow
              key={item.kind}
              open={face === "appearance"}
              onClick={onAppearance}
              rowRef={appearanceRowRef}
            />
          );
        }
        return (
          <SheetGroupItem
            key={item.kind}
            item={item.kind}
            href={item.href}
            onClick={destinationClickClosesSheet(pathname, item.href) ? onClose : undefined}
          >
            {item.label}
            <AccountRowChevron />
          </SheetGroupItem>
        );
      })}
    </>
  );
}

function AccountMenuBody({
  email,
  name,
  pathname,
  onClose,
  face,
  setFace,
  variant,
  appearanceRowRef,
}: {
  email: string;
  name?: string | null;
  pathname: string;
  onClose: () => void;
  face: AccountMenuFace;
  setFace: (face: AccountMenuFace) => void;
  variant: "sheet" | "dropdown";
  appearanceRowRef?: Ref<HTMLButtonElement>;
}) {
  const identity = accountSheetIdentity(email, name);
  const stacked = variant === "dropdown";
  const items = (
    <AccountMenuItems
      pathname={pathname}
      onClose={onClose}
      face={face}
      onAppearance={
        stacked
          ? () => setFace(face === "appearance" ? "main" : "appearance")
          : () => setFace("appearance")
      }
      appearanceRowRef={stacked ? appearanceRowRef : undefined}
    />
  );

  if (stacked) {
    return (
      <>
        <MenuSurfaceAccent />
        <div data-account-menu-stage="" className={ACCOUNT_MENU_DROPDOWN_STAGE_CLASS}>
          <div data-account-sheet-head="" className={ACCOUNT_MENU_DROPDOWN_HEAD_CLASS}>
            <IdentityBlock
              avatarInitial={identity.avatarInitial}
              name={identity.name}
              email={identity.email}
              className={ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS}
            />
          </div>
          <AppSheetHairline data-account-sheet-rule="" />
          <div data-account-sheet-scroll="" className={ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS}>
            <SheetGroup className={ACCOUNT_MENU_DROPDOWN_GROUP_CLASS}>{items}</SheetGroup>
          </div>
        </div>
        <div data-account-menu-leftover="" className={ACCOUNT_MENU_DROPDOWN_LEFTOVER_CLASS} />
        <AccountMenuPin onClose={onClose} className={ACCOUNT_MENU_DROPDOWN_PIN_CLASS} />
      </>
    );
  }

  return (
    <>
      <MenuSurfaceAccent />
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
            <SheetGroup>{items}</SheetGroup>
          </div>
          <AccountMenuPin onClose={onClose} className={ACCOUNT_SHEET_PIN_CLASS} />
        </>
      )}
    </>
  );
}

// Mobile 544:561 / 537:557 — avatar opens this sheet. Hamburger stays the nav sheet.
// Quiet scrim; page stays under. 90% viewport, slides up. Hug is void.
// Do not restyle to the desktop leftover dropdown.
// One top row: Identity 48 + Close/44. Hairline — USER_MENU_ACTIONS.
// Open Appearance replaces the list face on the same sheet. Back is
// the house 16 tertiary chevron — Close stays Close. 618:785 overlay
// is void. Closed sheet stays 544:561 / 537:557.
// Leftover under the last item is the 90% grow (open white). Log out,
// hairline, footer are pin siblings. Hairline only under Log out.
// Do not add a hairline above Log out. 571:911 stays off.
// Log out → hairline 24. Hairline → footer 24. Footer → bottom 32
// (sheet pad B). Not 48/48/48.
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
        controlsId="account-sheet"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 md:hidden"
      />
      {sheet && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet}
    </>
  );
}

// Desktop 629:795 — same items as mobile. 264 × 570 leftover 48.
// NOT 672. NOT 384. Align-end to the avatar (right edge flush).
// 8px under the trigger. Close killed. Stacked identity. 24 pad.
// 24 between Profile / Agreements / Appearance / Help / Refer.
// Leftover last-item → Log out is 48. No leftover grow. Pin Log out,
// hairline, footer as siblings. Hairline only under Log out. Log out
// → hairline 24. Hairline → footer 24. Do not hug the rule. Footer
// → bottom 24. Not a 90% sheet. Not a tall right takeover.
// Appearance 613:888 sits as a second 264 surface, gap 8 left of
// this parent. Flyout top = Appearance row top, offset 0.
export function DesktopAccountMenu({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const { pathname, open, openMenu, closeMenu } = useAccountMenuOpen();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const alignEnd = useDesktopAccountMenuAlignEnd(open, triggerRef);

  const dropdown = open ? (
    <AccountMenuDropdown
      email={email}
      name={name}
      pathname={pathname}
      onClose={closeMenu}
      alignEnd={alignEnd}
    />
  ) : null;

  return (
    <div className="hidden md:block" data-user-menu-desktop="">
      <AccountMenuTrigger
        email={email}
        open={open}
        onOpen={open ? closeMenu : openMenu}
        triggerRef={triggerRef}
        triggerAttr="data-user-menu-trigger"
        controlsId="account-menu-dropdown"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink"
      />
      {dropdown && typeof document !== "undefined"
        ? createPortal(dropdown, document.body)
        : dropdown}
    </div>
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
  const [face, setFace] = useState<AccountMenuFace>(initialFace);
  useAccountMenuDismiss(onClose, true);

  return (
    <div
      id="account-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={ACCOUNT_SHEET.sheet}
      data-account-sheet=""
      data-account-menu-face={face}
      className={ACCOUNT_SHEET_HOST_CLASS}
    >
      <button
        type="button"
        data-account-sheet-scrim=""
        aria-label={ACCOUNT_SHEET.close}
        onClick={onClose}
        className={APP_SHEET_SCRIM_CLASS}
      />
      <div data-account-sheet-surface="" className={ACCOUNT_SHEET_SURFACE_CLASS}>
        <AccountMenuBody
          email={email}
          name={name}
          pathname={pathname}
          onClose={onClose}
          face={face}
          setFace={setFace}
          variant="sheet"
        />
      </div>
    </div>
  );
}

export function AccountMenuDropdown({
  email,
  name,
  pathname,
  onClose,
  face: initialFace = "main",
  alignEnd,
}: {
  email: string;
  name?: string | null;
  pathname: string;
  onClose: () => void;
  face?: AccountMenuFace;
  alignEnd?: AccountMenuDropdownAlign;
}) {
  const [face, setFace] = useState<AccountMenuFace>(initialFace);
  useAccountMenuDismiss(onClose, false);
  const appearanceRowRef = useRef<HTMLButtonElement>(null);
  const flyoutHostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (face !== "appearance" || !alignEnd) return undefined;
    const sync = () => {
      const row = appearanceRowRef.current;
      const host = flyoutHostRef.current;
      if (!row || !host) return;
      const align = accountMenuAppearanceFlyoutAlign(alignEnd, row.getBoundingClientRect());
      host.style.top = align.top;
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [face, alignEnd]);

  const flyoutRight = alignEnd
    ? { right: accountMenuAppearanceFlyoutRight(alignEnd) }
    : undefined;

  return (
    <div
      id="account-menu-dropdown"
      role="dialog"
      aria-modal="true"
      aria-label={ACCOUNT_SHEET.sheet}
      data-user-menu-desktop-panel=""
      data-account-menu-face={face}
      className={ACCOUNT_MENU_DROPDOWN_HOST_CLASS}
    >
      <button
        type="button"
        data-user-menu-desktop-dismiss=""
        aria-label={ACCOUNT_SHEET.close}
        onClick={onClose}
        className={ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS}
      />
      <div
        data-user-menu-desktop-surface=""
        data-account-menu-align={ACCOUNT_MENU_DROPDOWN_ALIGN}
        className={ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS}
        style={alignEnd}
      >
        <AccountMenuBody
          email={email}
          name={name}
          pathname={pathname}
          onClose={onClose}
          face={face}
          setFace={setFace}
          variant="dropdown"
          appearanceRowRef={appearanceRowRef}
        />
      </div>
      {face === "appearance" ? (
        <div
          ref={flyoutHostRef}
          data-user-menu-appearance-flyout-host=""
          className={ACCOUNT_MENU_APPEARANCE_FLYOUT_HOST_CLASS}
          style={flyoutRight}
        >
          <AccountAppearanceFlyout />
        </div>
      ) : null}
    </div>
  );
}
