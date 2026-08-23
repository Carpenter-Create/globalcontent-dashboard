"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog } from "@/components/ui/dialog";
import { TITLES_CATALOG } from "@/lib/titles-catalog";
import { AddTitleForm } from "./add-title-form";

// The catalog's one accent action → modal with the existing AddTitleForm.
// Header Add Title is 13 Sporty Blue text, not a filled pill — desktop 1:3
// and mobile 528:542 / 529:542. Desktop titles grid stays. On success the
// dialog closes and the server component re-renders (router.refresh) so the
// new title appears in the catalog.
export function AddTitleButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="t-body-sm font-normal text-accent transition-colors hover:underline"
        data-add-title=""
      >
        {TITLES_CATALOG.addTitle}
      </button>
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
