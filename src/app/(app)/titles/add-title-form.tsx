"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { createTitle } from "./actions";

// Inline add-a-title form (house form pattern: controlled input, manual validation,
// greyscale inline notice — no red, per known-divergences D3). Write goes through
// the createTitle server action → create_title RPC.
export function AddTitleForm({ orgId }: { orgId: string }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await createTitle(orgId, title.trim());
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setTitle("");
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          aria-label="Title name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title name"
        />
        <Button type="submit" disabled={saving || !title.trim()} className="shrink-0">
          {saving ? "Adding…" : "Add title"}
        </Button>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
