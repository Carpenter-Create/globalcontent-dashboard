"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { saveVendor } from "./actions";

export type VendorInitial = {
  id?: string;
  name: string;
  deliveryMode: "portal_upload" | "email";
  emailTo: string;
  emailCc: string;
  emailTemplate: string;
  companyInfoJson: string;
  exportSpecJson: string;
  active: boolean;
};

const EMPTY: VendorInitial = {
  name: "",
  deliveryMode: "portal_upload",
  emailTo: "",
  emailCc: "",
  emailTemplate: "",
  companyInfoJson: "",
  exportSpecJson: "",
  active: true,
};

export function VendorForm({ initial }: { initial?: VendorInitial }) {
  const router = useRouter();
  const [v, setV] = useState<VendorInitial>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof VendorInitial>(k: K, val: VendorInitial[K]) {
    setV((s) => ({ ...s, [k]: val }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setError("Name is required.");
    setSaving(true);
    setError("");
    const res = await saveVendor(v);
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    // The create form lives ON the list page, so router.push here navigates to the
    // same route and the form stays mounted — reset its state explicitly, or the
    // button stays stuck on "Saving…". (The edit form navigates away and unmounts.)
    setSaving(false);
    if (!initial?.id) setV(EMPTY);
    router.push("/vendors");
    router.refresh();
  }

  const ta = "w-full rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body-sm text-ink outline-none focus:border-accent";

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Name</span>
        <Input value={v.name} onChange={(e) => set("name", e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Delivery mode</span>
        <select
          value={v.deliveryMode}
          onChange={(e) => set("deliveryMode", e.target.value as VendorInitial["deliveryMode"])}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body-sm text-ink"
        >
          <option value="portal_upload">Portal upload</option>
          <option value="email">Email</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email recipients (comma-separated)</span>
        <Input value={v.emailTo} onChange={(e) => set("emailTo", e.target.value)} placeholder="ops@vendor.example" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email CC (comma-separated)</span>
        <Input value={v.emailCc} onChange={(e) => set("emailCc", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Email template</span>
        <textarea value={v.emailTemplate} onChange={(e) => set("emailTemplate", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Company info (JSON, optional)</span>
        <textarea value={v.companyInfoJson} onChange={(e) => set("companyInfoJson", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-body-sm text-ink-2">Export format spec (JSON, optional)</span>
        <textarea value={v.exportSpecJson} onChange={(e) => set("exportSpecJson", e.target.value)} rows={3} className={ta} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        <span className="t-body-sm text-ink-2">Active</span>
      </label>

      <Button type="submit" disabled={saving} className="self-start">
        {saving ? "Saving…" : "Save vendor"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
