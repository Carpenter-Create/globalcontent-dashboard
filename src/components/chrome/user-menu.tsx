"use client";

import { signOut } from "@/app/actions";
import { userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";
import { DesktopAccountMenu, MobileAccountMenu } from "./account-sheet";

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
      className="flex items-center gap-[var(--space-4)]"
    >
      <div
        data-user-menu-avatar=""
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body font-normal text-ink-2"
      >
        {initial}
      </div>
      <div className="min-w-0">
        {displayName ? (
          <div data-user-menu-name="" className="truncate t-body font-normal text-ink">
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
  return (
    <>
      <MobileAccountMenu email={email} name={name} />
      <DesktopAccountMenu email={email} name={name} />
    </>
  );
}
