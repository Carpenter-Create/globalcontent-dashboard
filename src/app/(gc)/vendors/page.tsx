import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { VendorForm } from "./vendor-form";

const MODE_LABELS: Record<"portal_upload" | "email", string> = {
  portal_upload: "Portal upload",
  email: "Email",
};

export default async function GcVendorsPage() {
  const supabase = await createClient();
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, delivery_mode, active")
    .order("name", { ascending: true });
  const list = vendors ?? [];

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Vendors</h1>
      <p className="t-body-sm text-ink-3 pb-6">GC distribution partners. Portal credentials are never stored here.</p>

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No vendors yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="mb-8 flex flex-col gap-2">
          {list.map((vn) => (
            <Link key={vn.id} href={`/vendors/${vn.id}`} className="block">
              <Card className="transition-colors hover:bg-surface-muted">
                <CardBody className="flex items-center justify-between gap-4">
                  <span className="t-body font-medium text-ink">{vn.name}</span>
                  <span className="t-body-sm text-ink-3">
                    {MODE_LABELS[vn.delivery_mode]}
                    {vn.active ? "" : " · inactive"}
                  </span>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <h2 className="t-body font-medium text-ink pb-3">New vendor</h2>
      <VendorForm />
    </>
  );
}
