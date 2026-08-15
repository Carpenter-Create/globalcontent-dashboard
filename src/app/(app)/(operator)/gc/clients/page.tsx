import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InlineNotice } from "@/components/ui/inline-notice";
import { CLIENTS_PAGE, toClientRows, type ClientDirectoryRow } from "@/lib/clients";
import { UNPAGINATED_MAX, splitProbe } from "@/lib/list-bounds";

// GC operator client roster: one row per active seat, with the organization it belongs to.
// Supabase's Auth → Users list cannot show this (fixed column set, no Organization column),
// and gc_client_directory is the only read that pairs an email with ITS role — the older
// org_notification_recipients returns emails with no user_id. The (operator) layout is the
// authorization gate; the RPC re-checks is_gc_staff so a direct call fails closed too.
const COLUMNS = ["Email", "Organization", "Role", "Status", "Joined", "Last seen"] as const;

export default async function GcClientsPage() {
  const supabase = await createClient();

  // Probe one past the bound so truncation is VISIBLE rather than a short list that looks
  // complete (src/lib/list-bounds.ts).
  const { data } = await supabase.rpc("gc_client_directory", { p_limit: UNPAGINATED_MAX + 1 });
  const { rows: seats, truncated } = splitProbe(data as ClientDirectoryRow[] | null, UNPAGINATED_MAX);
  const rows = toClientRows(seats);

  return (
    <>
      <PageHeader title={CLIENTS_PAGE.title} subtitle={CLIENTS_PAGE.subtitle} />

      {truncated ? (
        <InlineNotice tone="error" className="mb-4">
          Showing the first {UNPAGINATED_MAX} seats. More exist — this list is not paginated yet.
        </InlineNotice>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">{CLIENTS_PAGE.empty}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="hidden gap-4 px-4 sm:grid sm:grid-cols-6">
            {COLUMNS.map((c) => (
              <span key={c} className="t-label text-ink-3">
                {c}
              </span>
            ))}
          </div>

          {rows.map((r) => (
            <Card key={r.userId}>
              <CardBody className="grid gap-1 sm:grid-cols-6 sm:items-center sm:gap-4">
                <span className="t-body-sm font-medium text-ink sm:truncate">{r.email}</span>
                <span className="t-body-sm text-ink">{r.organization}</span>
                <span className="t-body-sm text-ink-3">{r.role}</span>
                <span className="t-body-sm text-ink-3">{r.status}</span>
                <span className="t-body-sm text-ink-3">{r.joined}</span>
                <span className="t-body-sm text-ink-3">{r.lastSeen}</span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
