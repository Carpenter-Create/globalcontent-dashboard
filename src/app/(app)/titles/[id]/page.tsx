import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { AddRightsForm } from "./add-rights-form";

// Title detail — hosts the rights grants (§9). RLS-scoped; only operate-capable
// roles (account_owner, delivery_ops — §4) see the add form.
export default async function TitleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;
  if (!activeRow) redirect("/");
  const canOperate = activeRow.role === "account_owner" || activeRow.role === "delivery_ops";

  const { data: title } = await supabase
    .from("titles")
    .select("id, title, status, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound(); // RLS returns null for another org's title → 404

  const { data: grants } = await supabase
    .from("rights_grants")
    .select("id, rights_type, territory_mode, territories, window_start, window_end")
    .eq("title_id", id)
    .is("effective_to", null)
    .order("created_at", { ascending: false });

  const list = grants ?? [];

  return (
    <>
      <PageHeader
        title={title.title}
        subtitle="Rights & territories"
        backLink={{ href: "/titles", label: "Titles" }}
      />

      {canOperate ? (
        <div className="mb-6 max-w-xl">
          <AddRightsForm orgId={title.org_id} titleId={title.id} />
        </div>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No rights granted yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((g) => (
            <Card key={g.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <span className="t-body font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                <span className="shrink-0 t-body-sm text-ink-2">
                  {describeTerritory(g.territory_mode, g.territories)}
                </span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
