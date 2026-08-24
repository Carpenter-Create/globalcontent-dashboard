"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { COMPANY_PROFILE } from "@/lib/account-profile";
import { saveCompanyName } from "./actions";

// organizations.name. RLS manage_settings is the write gate; the form
// hides Save when the caller cannot edit.
export function CompanyProfileForm({
  name,
  canEdit,
}: {
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await saveCompanyName(value);
    if (res.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-[var(--space-4)]" data-company-profile-form="">
      <div className="flex flex-col gap-[var(--space-2)]">
        <Label htmlFor="company-name">{COMPANY_PROFILE.nameLabel}</Label>
        <Input
          id="company-name"
          name="company_name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          readOnly={!canEdit}
          aria-readonly={!canEdit}
          autoComplete="organization"
        />
      </div>
      {canEdit ? (
        <Button type="submit" disabled={saving} className="self-start">
          {saving ? COMPANY_PROFILE.saving : COMPANY_PROFILE.save}
        </Button>
      ) : (
        <p className="t-body-sm text-ink-3">{COMPANY_PROFILE.forbidden}</p>
      )}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {saved ? <InlineNotice>{COMPANY_PROFILE.saved}</InlineNotice> : null}
    </form>
  );
}
