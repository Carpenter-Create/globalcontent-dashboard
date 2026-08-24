"use client";

import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeGlyph } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import { toggleDocumentTheme } from "@/lib/theme";
import { USER_MENU, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";
import { MobileAccountMenu } from "./account-sheet";
import {
  MenuSurfaceContent,
  MenuSurfaceItem,
  MenuSurfaceSeparator,
} from "./menu-surface";

export const onUserMenuAppearance = toggleDocumentTheme;

export function onUserMenuLogOut(): void {
  void signOut();
}

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
          <MenuSurfaceContent data-user-menu="" sideOffset={10}>
            <UserMenuIdentity email={email} name={name} />
            <MenuSurfaceSeparator data-user-menu-hairline="" />
            <MenuSurfaceItem asChild>
              <Link href={USER_MENU.userProfileHref} data-user-menu-item="userProfile">
                {USER_MENU.userProfile}
              </Link>
            </MenuSurfaceItem>
            <MenuSurfaceItem asChild>
              <Link href={USER_MENU.companyProfileHref} data-user-menu-item="companyProfile">
                {USER_MENU.companyProfile}
              </Link>
            </MenuSurfaceItem>
            <MenuSurfaceItem asChild>
              <Link href={USER_MENU.agreementsHref} data-user-menu-item="agreements">
                {USER_MENU.agreements}
              </Link>
            </MenuSurfaceItem>
            <MenuSurfaceItem
              data-user-menu-item="appearance"
              onSelect={(event) => {
                event.preventDefault();
                onUserMenuAppearance();
              }}
            >
              <span className="flex-1">{USER_MENU.appearance}</span>
              <ThemeGlyph className="text-ink-3" />
            </MenuSurfaceItem>
            <MenuSurfaceSeparator data-user-menu-logout-hairline="" />
            <MenuSurfaceItem
              data-user-menu-item="logOut"
              onSelect={() => onUserMenuLogOut()}
            >
              {USER_MENU.logOut}
            </MenuSurfaceItem>
          </MenuSurfaceContent>
        </DropdownMenu>
      </div>
    </>
  );
}
