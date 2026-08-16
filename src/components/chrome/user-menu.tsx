"use client";

import Link from "next/link";
import { FileText, LogOut } from "lucide-react";

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
      className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-3)]"
    >
      <div
        data-user-menu-avatar=""
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body font-medium text-ink-2"
      >
        {initial}
      </div>
      <div className="min-w-0">
        {displayName ? (
          <div data-user-menu-name="" className="truncate t-body font-medium text-ink">
            {displayName}
          </div>
        ) : null}
        <div data-user-menu-email="" className="truncate t-body-sm text-ink-2">
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
    <DropdownMenu>
      <DropdownMenuTrigger
        data-user-menu-trigger=""
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[16.5rem] p-[var(--space-1)]" data-user-menu="">
        <UserMenuIdentity email={email} name={name} />
        <DropdownMenuSeparator data-user-menu-hairline="" />
        <DropdownMenuItem asChild>
          <Link href={USER_MENU.agreementsHref} data-user-menu-item="agreements">
            <FileText className="h-4 w-4" strokeWidth={1.5} />
            {USER_MENU.agreements}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-user-menu-item="appearance"
          onSelect={(event) => {
            event.preventDefault();
            onUserMenuAppearance();
          }}
        >
          <span className="flex-1">{USER_MENU.appearance}</span>
          <ThemeGlyph className="text-ink-3" />
        </DropdownMenuItem>
        <DropdownMenuItem data-user-menu-item="logOut" onSelect={() => onUserMenuLogOut()}>
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          {USER_MENU.logOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
