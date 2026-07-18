"use client";

import { ChevronsUpDown, Check } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { setActiveOrg } from "@/app/(app)/actions";
import { cn } from "@/lib/cn";

type Org = { id: string; name: string };

// Rewired off Watershed's tenant model onto organizations/memberships. Single org →
// plain label; multiple → switch (sets the active-org cookie via a server action).
export function OrganizationSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: Org[];
  activeOrgId: string | null;
}) {
  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  if (!active) return null;

  if (orgs.length < 2) {
    return <span className="t-body-sm font-medium text-ink">{active.name}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 t-body-sm font-medium text-ink transition-colors hover:bg-surface-muted">
        {active.name}
        <ChevronsUpDown className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => setActiveOrg(o.id)}>
            <Check
              className={cn("h-4 w-4", o.id === active.id ? "opacity-100" : "opacity-0")}
              strokeWidth={1.5}
            />
            {o.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
