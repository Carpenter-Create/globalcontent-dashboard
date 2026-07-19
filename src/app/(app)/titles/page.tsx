import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { AddTitleForm } from "./add-title-form";
import type { Database } from "@/lib/supabase/database.types";

type TitleStatus = Database["public"]["Enums"]["title_status"];

// Human labels for the §11 lifecycle. Only 'draft' is reachable this slice, but the
// map is complete so later transitions render without a follow-up change.
const STATUS_LABELS: Record<TitleStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  in_delivery: "In delivery",
  live: "Live",
  takedown_requested: "Takedown requested",
  taken_down: "Taken down",
};

// The catalog (§11, flat). RLS-scoped to the active org; only operate-capable roles
// (account_owner, delivery_ops — §4) see the add form.
export default async function TitlesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow =
    rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;
  if (!activeRow) redirect("/");
  const activeOrg = activeRow.organizations!;
  const canOperate = activeRow.role === "account_owner" || activeRow.role === "delivery_ops";

  // RLS-scoped to the org by policy; the eq is belt-and-suspenders + index use.
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, status, created_at, catalog_id")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false });

  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
  const list = titles ?? [];

  return (
    <>
      <PageHeader
        title="Titles"
        subtitle={`${activeOrg.name}'s catalog.${canOperate ? " Add a title to begin." : ""}`}
      />

      {canOperate ? (
        <div className="mb-6 max-w-xl">
          <AddTitleForm orgId={activeOrg.id} />
        </div>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No titles yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((t) => (
            <Link key={t.id} href={`/titles/${t.id}`} className="block">
              <Card className="transition-colors hover:bg-surface-muted">
                <CardBody className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">{t.title}</span>
                    <span className="t-body-sm text-ink-3">
                      {t.catalog_id} · Added {fmt.format(new Date(t.created_at))}
                    </span>
                  </div>
                  <span className="shrink-0 t-body-sm text-ink-2">
                    {STATUS_LABELS[t.status]}
                  </span>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
