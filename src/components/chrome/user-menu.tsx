"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useSystemThemeSync, useThemePreference } from "@/components/theme-toggle";
import { signOut } from "@/app/actions";
import { setDocumentThemePreference, type ThemePreference } from "@/lib/theme";
import {
  USER_MENU,
  USER_MENU_APPEARANCE_OPTIONS,
  userMenuAppearanceLabel,
  userMenuAvatarInitial,
  userMenuName,
} from "@/lib/user-menu";

export function onUserMenuLogOut(): void {
  void signOut();
}

export function onUserMenuAppearanceSelect(preference: ThemePreference): void {
  setDocumentThemePreference(preference);
}

// Mercury quiet: house tokens and .t-* only. More air than the default
// shadcn item padding. Do not restyle the shared primitive.
const USER_MENU_ITEM_CLASS =
  "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2";

const USER_MENU_RULE_CLASS = "my-[var(--space-2)]";

function MenuGlyph({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

function ExternalLinkGlyph({ className }: { className?: string }) {
  return (
    <MenuGlyph className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </MenuGlyph>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <MenuGlyph className={className}>
      <path d="m9 18 6-6-6-6" />
    </MenuGlyph>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <MenuGlyph className={className}>
      <path d="M20 6 9 17l-5-5" />
    </MenuGlyph>
  );
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
      className="flex flex-col items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-4)] text-center"
    >
      <div
        data-user-menu-avatar=""
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2"
      >
        {initial}
      </div>
      <div className="min-w-0 max-w-full">
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
  const preference = useThemePreference();
  useSystemThemeSync(preference);

  return (
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
        <DropdownMenuItem asChild className={USER_MENU_ITEM_CLASS}>
          <Link href={USER_MENU.agreementsHref} data-user-menu-item="agreements">
            {USER_MENU.agreements}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={USER_MENU_ITEM_CLASS}>
          <a
            href={USER_MENU.privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            data-user-menu-item="privacy"
          >
            <span className="flex-1">{USER_MENU.privacy}</span>
            <ExternalLinkGlyph className="text-ink-3" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator data-user-menu-hairline="" className={USER_MENU_RULE_CLASS} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className={USER_MENU_ITEM_CLASS}
            data-user-menu-item="appearance"
          >
            <span className="flex min-w-0 flex-1 flex-col items-start">
              <span>{USER_MENU.appearance}</span>
              <span
                data-user-menu-appearance-value=""
                className="t-body-sm text-ink-3"
              >
                {userMenuAppearanceLabel(preference)}
              </span>
            </span>
            <ChevronGlyph className="text-ink-3" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="min-w-[15.5rem] rounded-[var(--radius)] p-[var(--space-2)]"
            data-user-menu-appearance-submenu=""
            sideOffset={8}
          >
            {USER_MENU_APPEARANCE_OPTIONS.map((option) => {
              const checked = option.preference === preference;
              return (
                <DropdownMenuItem
                  key={option.preference}
                  className={USER_MENU_ITEM_CLASS}
                  data-user-menu-appearance-option={option.preference}
                  data-user-menu-appearance-checked={checked ? "" : undefined}
                  onSelect={() => onUserMenuAppearanceSelect(option.preference)}
                >
                  <span className="flex w-4 shrink-0 justify-center text-ink">
                    {checked ? <CheckGlyph /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <span>{option.label}</span>
                    {"hint" in option ? (
                      <span className="t-body-sm text-ink-3">{option.hint}</span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          className={USER_MENU_ITEM_CLASS}
          data-user-menu-item="logOut"
          onSelect={() => onUserMenuLogOut()}
        >
          {USER_MENU.logOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
