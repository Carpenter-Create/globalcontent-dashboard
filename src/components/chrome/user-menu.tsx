"use client";

import { Fragment } from "react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/actions";
import { USER_MENU_ACTIONS, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";
import { MobileAccountMenu } from "./account-sheet";
import {
  MenuSurfaceContent,
  MenuSurfaceItem,
  MenuSurfaceSeparator,
} from "./menu-surface";

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
            {USER_MENU_ACTIONS.map((item) => {
              if (item.kind === "logOut") {
                return (
                  <Fragment key={item.kind}>
                    <MenuSurfaceSeparator data-user-menu-logout-hairline="" />
                    <MenuSurfaceItem
                      data-user-menu-item={item.kind}
                      onSelect={() => onUserMenuLogOut()}
                    >
                      {item.label}
                    </MenuSurfaceItem>
                  </Fragment>
                );
              }
              return (
                <MenuSurfaceItem asChild key={item.kind}>
                  <Link href={item.href} data-user-menu-item={item.kind}>
                    {item.label}
                  </Link>
                </MenuSurfaceItem>
              );
            })}
          </MenuSurfaceContent>
        </DropdownMenu>
      </div>
    </>
  );
}
