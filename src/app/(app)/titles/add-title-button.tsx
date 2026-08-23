"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TITLES_CATALOG } from "@/lib/titles-catalog";
import { AddTitleForm } from "./add-title-form";

// The catalog's one accent action → modal with the existing AddTitleForm. Desktop
// 1:3 keeps the filled pill. Mobile 528:542 / 529:542 is 13 Sporty Blue text.
// On success the dialog closes and the server component re-renders
// (router.refresh) so the new title appears in the catalog.
export function AddTitleButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-[var(--space-6)] py-[var(--space-3)] max-md:gap-0 max-md:rounded-none max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:font-normal max-md:text-accent max-md:shadow-none max-md:hover:translate-y-0 max-md:hover:underline max-md:hover:opacity-100 max-md:active:translate-y-0"
        data-add-title=""
      >
        <Plus className="h-4 w-4 max-md:hidden" strokeWidth={2} />
        {TITLES_CATALOG.addTitle}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a title">
        <AddTitleForm
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}
