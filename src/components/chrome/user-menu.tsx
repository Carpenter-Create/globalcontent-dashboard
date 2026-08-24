"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppearanceCheck } from "./appearance-check";
import { useThemePreference } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import { APPEARANCE, APPEARANCE_OPTIONS, type AccountMenuFace } from "@/lib/appearance";
import { applyDocumentThemePreference } from "@/lib/theme";
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

export function UserMenuDesktopContent({
  email,
  name,
  face,
  onFace,
}: {
  email: string;
  name?: string | null;
  face: AccountMenuFace;
  onFace: (face: AccountMenuFace) => void;
}) {
  const preference = useThemePreference();

  if (face === "appearance") {
    return (
      <MenuSurfaceContent data-user-menu="" data-account-menu-face="appearance" sideOffset={10}>
        <MenuSurfaceItem
          data-user-menu-item="back"
          onSelect={(event) => {
            event.preventDefault();
            onFace("main");
          }}
        >
          {APPEARANCE.back}
        </MenuSurfaceItem>
        {APPEARANCE_OPTIONS.map((option) => (
          <MenuSurfaceItem
            key={option.kind}
            data-user-menu-item={option.kind}
            aria-pressed={preference === option.kind}
            onSelect={(event) => {
              event.preventDefault();
              applyDocumentThemePreference(option.kind);
            }}
          >
            <span className="flex-1">{option.label}</span>
            <AppearanceCheck selected={preference === option.kind} />
          </MenuSurfaceItem>
        ))}
      </MenuSurfaceContent>
    );
  }

  return (
    <MenuSurfaceContent data-user-menu="" data-account-menu-face="main" sideOffset={10}>
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
        if (item.kind === "appearance") {
          return (
            <MenuSurfaceItem
              key={item.kind}
              data-user-menu-item={item.kind}
              onSelect={(event) => {
                event.preventDefault();
                onFace("appearance");
              }}
            >
              {item.label}
            </MenuSurfaceItem>
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
  const [face, setFace] = useState<AccountMenuFace>("main");

  return (
    <>
      <MobileAccountMenu email={email} name={name} />
      <div className="hidden md:block" data-user-menu-desktop="">
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) setFace("main");
          }}
        >
          <DropdownMenuTrigger
            data-user-menu-trigger=""
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink"
          >
            {initial}
          </DropdownMenuTrigger>
          <UserMenuDesktopContent email={email} name={name} face={face} onFace={setFace} />
        </DropdownMenu>
      </div>
    </>
  );
}
