"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Minimal premium modal on the native <dialog> element: focus trap, Esc-to-close, and
// a11y come free — no Radix dep. Backdrop click closes.
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
      className="m-auto w-[min(92vw,32rem)] rounded-[var(--radius-lg)] border border-hairline bg-surface p-0 text-ink shadow-[var(--elevation)] backdrop:bg-black/40 backdrop:backdrop-blur-sm"
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
