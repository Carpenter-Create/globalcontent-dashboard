// Mobile 544:561 / 537:557 and desktop 629:795 Identity menu.
// Copy lives here, not in JSX.
// Identity is avatar + name + email from the same values /settings/profile
// would show. Always render both fields. No dashes, no invented
// local-part name. Items after the Identity hairline are
// USER_MENU_ACTIONS — the same list on mobile and desktop. Desktop
// Appearance is 613:888 beside — not a page. Mobile Appearance is a
// same-sheet drill-in that replaces the list face. Destinations use
// existing routes only — not /account/appearance. Company stays off
// this menu. Log out + version/Legal are the footer group — not a
// packed list row. Hairline only under Log out. No hairline above
// Log out. #209 #210 #211 hug / hairline-sandwich are void. 384 is
// void. 618:785 overlay is void.
// Mobile is a 90% sheet — leftover above Log out is flex-1 grow
// (open white). Do not hug. Log out, hairline, footer stay at the
// bottom. Log out → hairline 24. Hairline → footer 24. Footer →
// bottom 32 (sheet pad B). Not 48/48/48. No hairline above Log
// out. 571:911 stays off. Closed sheet is 544:561 / 537:557.
// Desktop 629:795 is 264 × 570 leftover 48, align-end. No 672
// floor. No leftover grow. 24 pad. 24 between Profile /
// Agreements / Appearance / Help / Refer. Log out → hairline 24.
// Hairline → footer 24. Footer → bottom 24. 613:888 top is the
// Appearance row, offset 0. Labels stay one source.

import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import { USER_MENU_ACTIONS, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";

export const ACCOUNT_SHEET = {
  close: "Close account",
  sheet: "Account",
} as const;

export const ACCOUNT_SHEET_ABSENT = [
  "Dashboard",
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Manage account",
  "ACCOUNT",
  "credits",
  "Buy",
  "User Profile",
  "Company Profile",
  "Phone",
  "Job",
] as const;

// One source, both instances. Sheet chrome may differ; labels may not.
export const ACCOUNT_SHEET_ITEMS = USER_MENU_ACTIONS;

// 544:561 / 537:557 — sides 24, bottom 32 (sheet pad B). 32 clear
// under the 4px half-bar (padT 36 = 4+32) so the bar does not eat
// the top air. 90% viewport.
// Not h-auto. Not max-h hug. Leftover above Log out is the 90% grow
// (open white). Identity 48 + Close/44 one row. Desktop 629:795
// does not use this surface.
export const ACCOUNT_SHEET_HOST_CLASS =
  "fixed inset-0 z-50 flex h-dvh w-full flex-col justify-end";

export const ACCOUNT_SHEET_SURFACE_CLASS =
  "account-sheet-surface relative z-10 flex h-[90dvh] w-full flex-col gap-[var(--space-6)] overflow-y-auto rounded-t-[16px] bg-surface px-[var(--space-6)] pb-[var(--space-8)] pt-[calc(4px+var(--space-8))] app-sheet-rise";

export const ACCOUNT_SHEET_HEAD_CLASS =
  "flex min-h-12 w-full shrink-0 items-center justify-between";

// Leftover grow. Overflow lives on the 90% surface.
export const ACCOUNT_SHEET_SCROLL_CLASS = "flex min-h-0 flex-1 flex-col";

export const ACCOUNT_SHEET_LOGOUT_CLASS =
  "flex items-center gap-[var(--space-2)] text-[length:var(--text-base)] font-normal leading-5 text-accent";

// Mobile pin — Log out, hairline, footer are siblings. Log out →
// hairline 24. Hairline → footer 24. Footer → bottom 32 (sheet
// pad B). Not 48/48/48. Leftover above Log out is the 90% grow.
// Do not put Log out in the item group. Pin gap is not
// (Log out+rule) → footer. Hairline only under Log out. 571:911
// stays off.
export const ACCOUNT_SHEET_PIN_CLASS =
  "flex w-full shrink-0 flex-col gap-[var(--space-6)]";

// Log out only. Hairline is the next pin sibling — do not hug the rule.
export const ACCOUNT_SHEET_LOGOUT_STACK_CLASS = "flex w-full shrink-0 flex-col";

// Footer on both menus — 13 Regular / 16. Version tertiary. Legal Sporty Blue.
export const ACCOUNT_SHEET_FOOTER_CLASS =
  "flex h-4 w-full shrink-0 items-center justify-between";

export const ACCOUNT_SHEET_VERSION_CLASS = "t-body-sm font-normal leading-4 text-ink-3";

export const ACCOUNT_SHEET_LEGAL_CLASS = `${TEXT_ACTION_CLASS} leading-4`;

// 629:795 — 264 × 570 leftover 48. NOT 672. NOT 384. NOT min-h
// 426. Align-end to the avatar (right edge flush). 8px
// (--space-2) under the trigger. Not a 90% sheet. 24 pad. 24
// between Profile / Agreements / Appearance / Help / Refer.
// Leftover last-item → Log out is 48. No leftover grow. Pin Log
// out, hairline, footer as siblings. Hairline only under Log out.
// Log out → hairline 24. Hairline → footer 24. Do not hug the
// rule. Pin gap is not (Log out+rule) → footer. Footer → bottom
// 24. padT 28 (4 bar + 24 air).
// Not a tall right takeover. Close killed — dismiss on outside click
// / avatar. Stacked identity. No ellipsis. Half-bar is 132×4 = 50% of 264.
// The surface is portaled to body, so top/right are measured from the
// trigger — not --header-height / --content-inset, which sat the 264
// a full avatar-width left (menu right = avatar left).
export const ACCOUNT_MENU_DROPDOWN_WIDTH = 264;
export const ACCOUNT_MENU_DROPDOWN_HEIGHT = 570;
export const ACCOUNT_MENU_DROPDOWN_LEFTOVER = 48;

export const ACCOUNT_MENU_DROPDOWN_HOST_CLASS = "fixed inset-0 z-50";

export const ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS = "absolute inset-0";

export const ACCOUNT_MENU_DROPDOWN_ALIGN = "end" as const;

export const ACCOUNT_MENU_DROPDOWN_GAP = "var(--space-2)" as const;

export const ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS =
  "absolute z-10 flex h-[570px] w-[264px] flex-col overflow-hidden rounded-[12px] border border-hairline bg-surface px-[var(--space-6)] pb-[var(--space-6)] pt-[calc(4px+var(--space-6))]";

export type AccountMenuDropdownAlign = {
  top: string;
  right: string;
};

export function accountMenuDropdownAlignEnd(
  trigger: Pick<DOMRect, "bottom" | "right">,
  viewportWidth: number,
): AccountMenuDropdownAlign {
  return {
    top: `calc(${trigger.bottom}px + ${ACCOUNT_MENU_DROPDOWN_GAP})`,
    right: `${viewportWidth - trigger.right}px`,
  };
}

export const ACCOUNT_MENU_DROPDOWN_HEAD_CLASS = "flex w-full flex-col items-start";

export const ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS =
  "flex min-w-0 w-full flex-col items-start gap-[var(--space-2)] break-words";

export const ACCOUNT_MENU_DROPDOWN_STAGE_CLASS =
  "flex w-full shrink-0 flex-col gap-[var(--space-6)]";

export const ACCOUNT_MENU_DROPDOWN_GROUP_CLASS =
  "flex w-full flex-col items-start gap-[var(--space-6)]";

// Desktop pin — Log out → hairline 24. Hairline → footer 24.
// Leftover last-item → Log out is 48, not leftover grow, not a
// packed 24 list row. Pin is not the item group. Pin gap is not
// (Log out+rule) → footer.
export const ACCOUNT_MENU_DROPDOWN_PIN_CLASS =
  "flex w-full shrink-0 flex-col gap-[var(--space-6)]";

export const ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS = "flex w-full shrink-0 flex-col";

export const ACCOUNT_MENU_DROPDOWN_LEFTOVER_CLASS = "h-[48px] w-full shrink-0";

// 586:768 Appearance row — pad T/B 16, L/R 0, r0. Wash full-bleed
// on the 216 content row. Label x=0 with Profile / Help. Chevron
// right edge 216. Appearance 15 + current mode 13. Chevron 16.
// No inset card.
export const ACCOUNT_MENU_APPEARANCE_ROW_CLASS =
  "relative flex w-full items-center justify-between py-[var(--space-4)] text-left text-[length:var(--text-base)] font-normal leading-5 text-ink";

export const ACCOUNT_MENU_APPEARANCE_WASH_CLASS =
  "pointer-events-none absolute inset-y-0 -left-[var(--space-6)] -right-[var(--space-6)] z-0 bg-surface-muted";

export const ACCOUNT_MENU_APPEARANCE_COPY_CLASS =
  "relative z-10 flex min-w-0 flex-col items-start gap-[var(--space-2)]";

export const ACCOUNT_MENU_APPEARANCE_CHEVRON_CLASS = "relative z-10 shrink-0";

export const ACCOUNT_MENU_APPEARANCE_MODE_CLASS =
  "t-body-sm font-normal leading-4 text-ink-2";

// 613:888 — second 264 surface. Desktop: gap 8 left of the parent.
// Top = Appearance row top, offset 0. Not parent menu top.
// Row pad 16 / gap 8. r12 hairline. Not in-place. No purple.
export const ACCOUNT_MENU_APPEARANCE_FLYOUT_GAP = "var(--space-2)" as const;

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_OFFSET = 0;

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_CLASS =
  "flex w-[264px] max-w-full flex-col gap-[var(--space-2)] overflow-hidden rounded-[12px] border border-hairline bg-surface py-[var(--space-2)]";

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_ROW_CLASS =
  "flex w-full items-start gap-[var(--space-2)] p-[var(--space-4)] text-left text-[length:var(--text-base)] font-normal leading-5 text-ink";

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_HELPER_CLASS =
  "t-body-sm font-normal leading-4 text-ink-2";

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_MARK_CLASS = "size-4 shrink-0";

// Mobile Appearance drill-in — same sheet, replaces the list face.
// House rows. Not 618:785. Not a card. Not 613:888.
export const ACCOUNT_SHEET_APPEARANCE_COPY_CLASS =
  "flex min-w-0 flex-col items-start gap-[var(--space-2)]";

export const ACCOUNT_MENU_APPEARANCE_FLYOUT_HOST_CLASS =
  "absolute z-10 w-[264px]";

export function accountMenuAppearanceFlyoutAlign(
  parent: Pick<AccountMenuDropdownAlign, "right">,
  appearanceRow: Pick<DOMRect, "top">,
): AccountMenuDropdownAlign {
  return {
    top: `${appearanceRow.top + ACCOUNT_MENU_APPEARANCE_FLYOUT_OFFSET}px`,
    right: `calc(${parent.right} + ${ACCOUNT_MENU_DROPDOWN_WIDTH}px + ${ACCOUNT_MENU_APPEARANCE_FLYOUT_GAP})`,
  };
}

export function accountMenuAppearanceFlyoutRight(
  parent: Pick<AccountMenuDropdownAlign, "right">,
): string {
  return `calc(${parent.right} + ${ACCOUNT_MENU_DROPDOWN_WIDTH}px + ${ACCOUNT_MENU_APPEARANCE_FLYOUT_GAP})`;
}

export type AccountSheetIdentity = {
  avatarInitial: string;
  name: string;
  email: string;
};

function accountSheetEmail(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function accountSheetIdentity(
  email: string,
  name?: string | null,
): AccountSheetIdentity {
  return {
    avatarInitial: userMenuAvatarInitial(email),
    name: userMenuName(name) ?? "",
    email: accountSheetEmail(email),
  };
}

export function destinationClickClosesSheet(pathname: string, href: string): boolean {
  return pathname === href;
}
