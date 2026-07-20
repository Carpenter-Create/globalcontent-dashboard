import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL_COPY } from "@/lib/portal";
import { Card, CardBody } from "@/components/ui/card";
import { PortalFlow } from "./portal-flow";

// Server Component: resolves link validity with the service-role admin client (no
// user JWT exists for an account-less recipient) before handing off to the client
// flow. An invalid/expired/revoked link renders the same expired-link card either
// way — never leaks *why* to an unauthenticated caller.
export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, expires_at, revoked_at, assets(original_filename, bytes)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  const valid = link && !link.revoked_at && new Date(link.expires_at) >= new Date();
  if (!valid) {
    return (
      <Card>
        <CardBody>
          <h1 className="t-subhead mb-2">{PORTAL_COPY.roomTitle}</h1>
          <p className="t-body text-ink-2">{PORTAL_COPY.errorExpired}</p>
        </CardBody>
      </Card>
    );
  }

  const asset = Array.isArray(link.assets) ? link.assets[0] : link.assets;
  return (
    <PortalFlow
      token={token}
      filename={asset?.original_filename ?? PORTAL_COPY.unknownFilename}
      bytes={asset?.bytes ?? 0}
    />
  );
}
