import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { PageHeader } from "@/components/ui/page-header";
import { MetadataForm } from "./metadata-form";
import { METADATA_FIELDS } from "@/lib/metadata";

// Guided metadata form (§12 path 1). RLS-scoped; only operate-capable roles
// (account_owner, delivery_ops — §4) edit; others get a read-only view.
export default async function TitleMetadataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // Resolved once per request and shared with the layout above (React cache()).
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const { data: title } = await supabase
    .from("titles")
    .select("id, title, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound();

  // The role in the org that owns THIS title -- not necessarily the active org.
  // ctx.rows already holds every active membership, so this needs no extra query.
  const titleRole = ctx.rows.find((r) => r.organizations.id === title.org_id)?.role;
  const canOperate = titleRole === "account_owner" || titleRole === "delivery_ops";

  const { data: row } = await supabase
    .from("title_metadata")
    .select("data")
    .eq("title_id", id)
    .maybeSingle();
  const data = (row?.data as Record<string, unknown> | null) ?? {};

  return (
    <>
      <PageHeader
        title={title.title}
        subtitle="Metadata"
        backLink={{ href: `/titles/${id}`, label: "Back to title" }}
      />
      {canOperate ? (
        <MetadataForm orgId={title.org_id} titleId={title.id} initial={data} />
      ) : (
        <dl className="flex max-w-xl flex-col gap-2">
          {METADATA_FIELDS.map((f) => {
            const v = data[f.key];
            let shown: string;
            if (Array.isArray(v)) shown = v.length ? v.join(", ") : "—";
            else if (v == null || v === "") shown = "—";
            else if (f.type === "select") shown = f.vocab?.find((o) => o.value === v)?.label ?? String(v);
            else shown = String(v);
            return (
              <div key={f.key} className="flex justify-between gap-4 border-b border-hairline py-1.5">
                <dt className="t-body-sm text-ink-3">{f.label}</dt>
                <dd className="t-body-sm text-ink-2">{shown}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </>
  );
}
