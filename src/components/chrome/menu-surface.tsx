"use client";

import type { ComponentProps } from "react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import {
  MENU_SURFACE_CONTENT_CLASS,
  MENU_SURFACE_ITEM_CLASS,
  MENU_SURFACE_ITEM_DANGER_CLASS,
  MENU_SURFACE_SEPARATOR_CLASS,
} from "@/lib/menu-surface";

export function MenuSurfaceContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn(MENU_SURFACE_CONTENT_CLASS, className)}
      {...props}
    />
  );
}

export function MenuSurfaceItem({
  danger = false,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean }) {
  return (
    <DropdownMenuItem
      className={cn(
        MENU_SURFACE_ITEM_CLASS,
        danger && MENU_SURFACE_ITEM_DANGER_CLASS,
        className,
      )}
      {...props}
    />
  );
}

export function MenuSurfaceSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSeparator>) {
  return (
    <DropdownMenuSeparator
      className={cn(MENU_SURFACE_SEPARATOR_CLASS, className)}
      {...props}
    />
  );
}

// Thread ··· instances the same surface. Items differ; chrome does not.
export function ThreadPopoverContent(
  props: ComponentProps<typeof MenuSurfaceContent>,
) {
  return <MenuSurfaceContent data-thread-popover="" {...props} />;
}

export function ThreadPopoverItem({
  danger = false,
  ...props
}: ComponentProps<typeof MenuSurfaceItem>) {
  return (
    <MenuSurfaceItem
      data-thread-popover-item={danger ? "delete" : ""}
      danger={danger}
      {...props}
    />
  );
}

export function ThreadPopoverSeparator(
  props: ComponentProps<typeof MenuSurfaceSeparator>,
) {
  return <MenuSurfaceSeparator data-thread-popover-hairline="" {...props} />;
}
