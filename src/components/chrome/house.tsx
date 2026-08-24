"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import {
  APP_SHEET_HAIRLINE_CLASS,
  APP_SHEET_HEAD_CLASS,
  APP_SHEET_SURFACE_CLASS,
  CLOSE_44_CLASS,
  IDENTITY_AVATAR_CLASS,
  IDENTITY_BLOCK_CLASS,
  IDENTITY_EMAIL_CLASS,
  IDENTITY_NAME_CLASS,
  SHEET_GROUP_CLASS,
  SHEET_GROUP_ITEM_CLASS,
  SHEET_GROUP_LABEL_CLASS,
  TEXT_ACTION_CLASS,
  THREAD_POPOVER_CONTENT_CLASS,
  THREAD_POPOVER_DELETE_CLASS,
  THREAD_POPOVER_ITEM_CLASS,
} from "@/lib/house-sheet";

// 543:562 Close/44 — muted 44 circle, lucide X 16 / 1.33 tertiary.
export function Close44({
  label,
  className,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(CLOSE_44_CLASS, className)}
      {...props}
    >
      <X className="size-4" strokeWidth={1.33} />
    </button>
  );
}

// 543:563 Text action — 13 Regular Sporty Blue.
export function TextAction({
  href,
  children,
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={cn(TEXT_ACTION_CLASS, className)} {...props}>
      {children}
    </Link>
  );
}

// 543:565 Identity block — 48 circle. Name/email only when present.
export function IdentityBlock({
  avatarInitial,
  name,
  email,
  action,
}: {
  avatarInitial: string;
  name?: string | null;
  email?: string | null;
  action?: ReactNode;
}) {
  return (
    <div data-identity-block="" className={IDENTITY_BLOCK_CLASS}>
      <div data-identity-avatar="" className={IDENTITY_AVATAR_CLASS}>
        {avatarInitial}
      </div>
      {name || email ? (
        <div data-identity-who="" className="flex flex-col items-start gap-[var(--space-2)]">
          {name ? (
            <p data-identity-name="" className={IDENTITY_NAME_CLASS}>
              {name}
            </p>
          ) : null}
          {email ? (
            <p data-identity-email="" className={IDENTITY_EMAIL_CLASS}>
              {email}
            </p>
          ) : null}
        </div>
      ) : null}
      {action}
    </div>
  );
}

// 543:570 Group — eyebrow then rows.
export function SheetGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-sheet-group="" className={SHEET_GROUP_CLASS}>
      <p data-sheet-group-label="" className={SHEET_GROUP_LABEL_CLASS}>
        {label}
      </p>
      {children}
    </div>
  );
}

export function SheetGroupItem({
  href,
  onClick,
  children,
  item,
}: {
  href?: string | null;
  onClick?: () => void;
  children: ReactNode;
  item?: string;
}) {
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        data-sheet-group-item={item}
        className={SHEET_GROUP_ITEM_CLASS}
      >
        {children}
      </Link>
    );
  }
  return (
    <p data-sheet-group-item={item} className={SHEET_GROUP_ITEM_CLASS}>
      {children}
    </p>
  );
}

// 543:576 App sheet chrome — same sheet as nav, different body.
export function AppSheetSurface({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn(APP_SHEET_SURFACE_CLASS, className)} {...props} />;
}

export function AppSheetHead({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn(APP_SHEET_HEAD_CLASS, className)} {...props} />;
}

export function AppSheetHairline({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn(APP_SHEET_HAIRLINE_CLASS, className)} {...props} />;
}

// 544:592 Thread Popover — 15 Regular ink, pad 16, gap 8, r12, quiet hairline.
export function ThreadPopoverContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent className={cn(THREAD_POPOVER_CONTENT_CLASS, className)} {...props} />
  );
}

export function ThreadPopoverItem({
  danger = false,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean }) {
  return (
    <DropdownMenuItem
      className={cn(danger ? THREAD_POPOVER_DELETE_CLASS : THREAD_POPOVER_ITEM_CLASS, className)}
      {...props}
    />
  );
}
