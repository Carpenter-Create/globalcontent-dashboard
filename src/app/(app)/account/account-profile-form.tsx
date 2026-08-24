"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ACCOUNT_PROFILE } from "@/lib/account-profile";
import { saveAccountName } from "./actions";

// Name writes user_metadata.display_name. Email is the session login email
// and is not changed here (auth gate).
export function AccountProfileForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await saveAccountName(value);
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
    <form onSubmit={onSubmit} className="flex flex-col gap-[var(--space-4)]" data-account-profile-form="">
      <div className="flex flex-col gap-[var(--space-2)]">
        <Label htmlFor="account-name">{ACCOUNT_PROFILE.nameLabel}</Label>
        <Input
          id="account-name"
          name="name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          autoComplete="name"
        />
      </div>
      <div className="flex flex-col gap-[var(--space-2)]">
        <Label htmlFor="account-email">{ACCOUNT_PROFILE.emailLabel}</Label>
        <Input
          id="account-email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
        />
        <p className="t-body-sm text-ink-3">{ACCOUNT_PROFILE.emailHint}</p>
      </div>
      <Button type="submit" disabled={saving} className="self-start">
        {saving ? ACCOUNT_PROFILE.saving : ACCOUNT_PROFILE.save}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {saved ? <InlineNotice>{ACCOUNT_PROFILE.saved}</InlineNotice> : null}
    </form>
  );
}
