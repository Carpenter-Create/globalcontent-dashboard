"use client";

import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThemeGlyph } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import { toggleDocumentTheme } from "@/lib/theme";
import { USER_MENU, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";
import { MobileAccountMenu } from "./account-overlay";

export const onUserMenuAppearance = toggleDocumentTheme;

export function onUserMenuLogOut(): void {
  void signOut();
}

// Mercury quiet: house tokens and .t-* only. More air than the default
// shadcn item padding. Do not restyle the shared primitive.
const USER_MENU_ITEM_CLASS =
  "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2";

const USER_MENU_RULE_CLASS = "my-[var(--space-2)]";

export function UserMenuIdentity({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const displayName = userMenuName(name);
  const initial = userMenuAvatarInitial(email);

  return (
    <div
      data-user-menu-identity=""
      className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-4)]"
    >
      <div
        data-user-menu-avatar=""
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2"
      >
        {initial}
      </div>
      <div className="min-w-0">
        {displayName ? (
          <div data-user-menu-name="" className="truncate t-body-sm font-medium text-ink">
            {displayName}
          </div>
        ) : null}
        <div data-user-menu-email="" className="truncate t-body-sm text-ink-3">
          {email}
        </div>
      </div>
    </div>
  );
}

export function UserMenu({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const initial = userMenuAvatarInitial(email);

  return (
    <>
      <MobileAccountMenu email={email} name={name} />
      <div className="hidden md:block" data-user-menu-desktop="">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-user-menu-trigger=""
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink"
          >
            {initial}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[17.5rem] rounded-[var(--radius)] p-[var(--space-2)]"
            data-user-menu=""
            sideOffset={10}
          >
            <UserMenuIdentity email={email} name={name} />
            <DropdownMenuSeparator data-user-menu-hairline="" className={USER_MENU_RULE_CLASS} />
            <DropdownMenuItem asChild className={USER_MENU_ITEM_CLASS}>
              <Link href={USER_MENU.agreementsHref} data-user-menu-item="agreements">
                {USER_MENU.agreements}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={USER_MENU_ITEM_CLASS}
              data-user-menu-item="appearance"
              onSelect={(event) => {
                event.preventDefault();
                onUserMenuAppearance();
              }}
            >
              <span className="flex-1">{USER_MENU.appearance}</span>
              <ThemeGlyph className="text-ink-3" />
            </DropdownMenuItem>
            <DropdownMenuSeparator data-user-menu-logout-hairline="" className={USER_MENU_RULE_CLASS} />
            <DropdownMenuItem
              className={USER_MENU_ITEM_CLASS}
              data-user-menu-item="logOut"
              onSelect={() => onUserMenuLogOut()}
            >
              {USER_MENU.logOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
