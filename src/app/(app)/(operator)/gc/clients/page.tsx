import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InlineNotice } from "@/components/ui/inline-notice";
import { CLIENTS_PAGE, toClientOrgs, type ClientDirectoryRow } from "@/lib/clients";
import { UNPAGINATED_MAX, splitProbe } from "@/lib/list-bounds";

// GC operator client roster, grouped by organization. Supabase's Auth → Users list cannot show
// the org at all (fixed column set), and gc_client_directory is the only read that pairs an
// email with ITS role — the older org_notification_recipients returns emails with no user_id.
//
// Grouped rather than one row per seat because organization, tier, and status are facts about
// the ORG: a flat table repeats them on every seat. Only email, role, and last-seen vary per
// person, so those are the columns inside a card.
//
// The (operator) layout is the authorization gate; the RPC re-checks is_gc_staff so a direct
// call fails closed too.
export default async function GcClientsPage() {
  const supabase = await createClient();

  // Probe one past the bound so truncation is VISIBLE rather than a short list that looks
  // complete (src/lib/list-bounds.ts). The bound is on seats, not orgs — the RPC returns seats.
  const { data } = await supabase.rpc("gc_client_directory", { p_limit: UNPAGINATED_MAX + 1 });
  const { rows: seats, truncated } = splitProbe(data as ClientDirectoryRow[] | null, UNPAGINATED_MAX);
  const orgs = toClientOrgs(seats);

  return (
    <>
      <PageHeader title={CLIENTS_PAGE.title} subtitle={CLIENTS_PAGE.subtitle} />

      {truncated ? (
        <InlineNotice tone="error" className="mb-4">
          Showing the first {UNPAGINATED_MAX} seats. More exist — this list is not paginated yet.
        </InlineNotice>
      ) : null}

      {orgs.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">{CLIENTS_PAGE.empty}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {orgs.map((org) => (
            <Card key={org.orgId}>
              <CardBody className="flex flex-col gap-3">
                {/* Org-level facts, stated once. Tier carries Stripe's status when abnormal. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="t-body font-medium text-ink">{org.organization}</span>
                  <span className="t-body-sm text-ink-2">
                    {org.tier} · {org.status}
                    {org.termEnds ? (
                      <span className="text-ink-3"> · term ends {org.termEnds}</span>
                    ) : null}
                  </span>
                </div>

                {/* Seats. A real table so the header is associated with the cells. */}
                <table className="w-full border-t border-hairline">
                  <thead>
                    <tr className="text-left">
                      <th scope="col" className="t-label py-2 font-normal text-ink-3">
                        Email
                      </th>
                      <th scope="col" className="t-label py-2 font-normal text-ink-3">
                        Role
                      </th>
                      <th scope="col" className="t-label py-2 text-right font-normal text-ink-3">
                        Last seen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.seats.map((seat) => (
                      <tr key={seat.userId}>
                        <td className="t-body-sm py-1 text-ink">{seat.email}</td>
                        <td className="t-body-sm py-1 text-ink-3">{seat.role}</td>
                        <td className="t-body-sm py-1 text-right text-ink-3">{seat.lastSeen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
