"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { linkTitleToWork } from "./actions";

export type Suggestion = { title_id: string; title: string; org_name: string; release_year: string | null };

export function LinkControls({ titleId, suggestions }: { titleId: string; suggestions: Suggestion[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (suggestions.length === 0) return null;

  async function link(targetTitleId: string) {
    setBusy(true);
    setError("");
    const res = await linkTitleToWork(titleId, targetTitleId);
    if (res?.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-hairline bg-surface-muted p-3">
      <span className="t-body-sm font-medium text-ink-2">Possible same-work matches</span>
      {suggestions.map((s) => (
        <div key={s.title_id} className="flex items-center justify-between gap-3">
          <span className="t-body-sm text-ink-2">
            {s.title} · {s.org_name}
            {s.release_year ? ` · ${s.release_year}` : ""}
          </span>
          <Button variant="secondary" onClick={() => link(s.title_id)} disabled={busy} className="shrink-0">
            Link as same work
          </Button>
        </div>
      ))}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
