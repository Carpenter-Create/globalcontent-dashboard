"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

// Minimal premium modal on the native <dialog> element: focus trap, Esc-to-close, and
// a11y come free — no Radix dep. Backdrop click closes. `size` widens it for media
// (the video player) without touching the default form width.
const SIZES = {
  md: "w-[min(92vw,32rem)]",
  xl: "w-[min(94vw,56rem)]",
} as const;

export function Dialog({
  open,
  onClose,
  title,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof SIZES;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop (the dialog element itself)
      }}
      className={cn(
        "m-auto rounded-[var(--radius-lg)] border border-hairline bg-surface p-0 text-ink shadow-[var(--elevation)] backdrop:bg-black/40 backdrop:backdrop-blur-sm",
        SIZES[size],
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <h2 className="t-body font-medium text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-ink-3 transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
