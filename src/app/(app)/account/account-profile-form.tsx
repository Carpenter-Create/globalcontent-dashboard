"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/ui/inline-notice";
import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import {
  ACCOUNT_FIELD_CLASS,
  ACCOUNT_NAME_MAX,
  ACCOUNT_PHOTO_CIRCLE_CLASS,
  ACCOUNT_PROFILE,
} from "@/lib/account-profile";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, isAvatarContentType } from "@/lib/account-avatar";
import { saveAccountName, uploadAccountPhoto } from "./actions";

// Name writes user_metadata.display_name. Email is the session login email
// and is not changed here (auth gate). Photo PUTs to the dedicated avatars
// bucket under avatars/{user-id}/avatar — not the title bucket.
export function AccountProfileForm({
  name,
  email,
  photoUrl,
}: {
  name: string;
  email: string;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
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
    form.querySelector<HTMLInputElement>("#account-name")?.blur();
    router.refresh();
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError("");
    setSaved(false);
    if (!isAvatarContentType(file.type)) {
      setError(ACCOUNT_PROFILE.photoType);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(ACCOUNT_PROFILE.photoTooLarge);
      return;
    }
    setUploading(true);
    const body = new FormData();
    body.set("photo", file);
    const res = await uploadAccountPhoto(body);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-[var(--space-4)]" data-account-profile-form="">
      <div className="flex items-center gap-[var(--space-2)]" data-account-photo="">
        <div className={ACCOUNT_PHOTO_CIRCLE_CLASS} data-account-photo-circle="" aria-hidden={photoUrl ? undefined : true}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed GET from the private avatars bucket
            <img src={photoUrl} alt={ACCOUNT_PROFILE.photoAlt} className="size-full object-cover" />
          ) : null}
        </div>
        <button
          type="button"
          className={TEXT_ACTION_CLASS}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? ACCOUNT_PROFILE.uploadingPhoto : ACCOUNT_PROFILE.uploadPhoto}
        </button>
        <input
          ref={fileRef}
          id="account-photo"
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          aria-label={ACCOUNT_PROFILE.uploadPhoto}
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
      </div>
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
          maxLength={ACCOUNT_NAME_MAX}
          autoComplete="name"
          className={ACCOUNT_FIELD_CLASS}
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
          className={ACCOUNT_FIELD_CLASS}
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
