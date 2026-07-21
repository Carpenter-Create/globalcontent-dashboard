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
    .select("id, expires_at, revoked_at, purpose, title_id, assets(original_filename, bytes)")
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

  if (link.purpose === "screener_view" && link.title_id) {
    // Curated title info for display only — not authz. The actual stream is re-resolved
    // session-side by portal_resolve_screener (service-role, no rule-12 gate: pitch view).
    const [{ data: titleRow }, { data: metaRow }] = await Promise.all([
      admin.from("titles").select("title").eq("id", link.title_id).maybeSingle(),
      admin.from("title_metadata").select("data").eq("title_id", link.title_id).maybeSingle(),
    ]);
    const meta = (metaRow?.data ?? {}) as { synopsis?: string; runtime_minutes?: number };
    return (
      <PortalFlow
        token={token}
        ready={{
          mode: "screener",
          title: titleRow?.title ?? PORTAL_COPY.unknownTitle,
          synopsis: meta.synopsis ?? null,
          runtimeMinutes: meta.runtime_minutes ?? null,
        }}
      />
    );
  }

  const asset = Array.isArray(link.assets) ? link.assets[0] : link.assets;
  return (
    <PortalFlow
      token={token}
      ready={{
        mode: "download",
        filename: asset?.original_filename ?? PORTAL_COPY.unknownFilename,
        bytes: asset?.bytes ?? 0,
      }}
    />
  );
}
