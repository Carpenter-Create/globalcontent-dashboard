"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  deliveryMode: z.enum(["portal_upload", "email"]),
  emailTo: z.string(),
  emailCc: z.string(),
  emailTemplate: z.string(),
  companyInfoJson: z.string(),
  exportSpecJson: z.string(),
  active: z.boolean(),
});

function toList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function parseJsonOrNull(s: string): { ok: true; value: unknown } | { ok: false } {
  const t = s.trim();
  if (t === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

// GC-admin vendor create/update. RLS (is_gc_staff) is the boundary; this is a
// direct table write (not an RPC) inside a server action — see known-divergences.
export async function saveVendor(raw: unknown): Promise<{ error?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const emailTo = toList(v.emailTo);
  if (v.deliveryMode === "email" && emailTo.length === 0) {
    return { error: "Email delivery requires at least one recipient." };
  }
  const company = parseJsonOrNull(v.companyInfoJson);
  const spec = parseJsonOrNull(v.exportSpecJson);
  if (!company.ok) return { error: "Company info is not valid JSON." };
  if (!spec.ok) return { error: "Export format spec is not valid JSON." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const row = {
    name: v.name.trim(),
    delivery_mode: v.deliveryMode,
    email_to: emailTo,
    email_cc: toList(v.emailCc),
    email_template: v.emailTemplate.trim() || null,
    company_info: company.value as never,
    export_format_spec: spec.value as never,
    active: v.active,
  };

  const { error } = v.id
    ? await supabase.from("vendors").update(row).eq("id", v.id)
    : await supabase.from("vendors").insert(row);
  if (error) {
    // 23505 = unique_violation on vendors_name_unique (case-insensitive). Return a
    // clean message rather than leaking the Postgres constraint text into the UI.
    if (error.code === "23505") return { error: "A vendor with this name already exists." };
    return { error: error.message };
  }

  revalidatePath("/gc/vendors");
  return {};
}
