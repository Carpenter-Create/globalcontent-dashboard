"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { submitTitle } from "./actions";

export function SubmitButton({ orgId, titleId }: { orgId: string; titleId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit() {
    setSaving(true);
    setError("");
    const res = await submitTitle(orgId, titleId);
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={onSubmit} disabled={saving} className="self-start">
        {saving ? "Submitting…" : "Submit for review"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
