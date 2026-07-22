"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AddTitleForm } from "./add-title-form";

// The "+ Title" call to action → modal with the existing AddTitleForm. On success the
// dialog closes and the server component re-renders (router.refresh) so the new title
// appears in the catalog.
export function AddTitleButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        Title
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
