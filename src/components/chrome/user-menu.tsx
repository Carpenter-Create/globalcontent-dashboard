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
import { signOut } from "@/app/actions";

export function UserMenu({ email }: { email: string }) {
  const initial = (email.charAt(0) || "?").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted t-body-sm font-medium text-ink-2 transition-colors hover:text-ink">
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="truncate px-2.5 py-1.5 t-body-sm text-ink-2">{email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/agreements">
            <FileText className="h-4 w-4" strokeWidth={1.5} />
            Agreements
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
