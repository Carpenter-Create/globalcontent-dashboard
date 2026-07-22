import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { NOTIFICATION_KIND_LABEL, NOTIFICATION_EMAIL, MESSAGES_EMPTY, MESSAGES_SUBTITLE } from "@/lib/notifications";
import { MarkAllRead } from "./mark-all-read";
import { MarkRead } from "./mark-read";
import { MessageLink } from "./message-link";

// §20 GC-Support in-app inbox: the client's notifications, newest first, per-user unread.
export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: notifications } = await supabase.rpc("my_notifications");
  const list = notifications ?? [];
  const unreadIds = list.filter((n) => n.unread).map((n) => n.id);

  return (
    <>
      <PageHeader title="Messages" subtitle={MESSAGES_SUBTITLE} />

      {unreadIds.length > 0 ? (
        <div className="pb-4">
          <MarkAllRead ids={unreadIds} />
        </div>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">{MESSAGES_EMPTY}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((n) => {
            // Deep-link the message to where the client acts on it: a rejected title →
            // its detail page (to fix + resubmit), a delivery update → /deliveries.
            // Reuses the same path map the email CTA uses. MarkRead stays outside the
            // link so clicking it doesn't navigate (and to keep valid button-in-anchor HTML).
            const refs = (n.source_refs ?? {}) as { title_id?: string };
            const href = NOTIFICATION_EMAIL[n.kind].path({ titleId: refs.title_id });
            return (
              <Card key={n.id}>
                <CardBody className={cn(n.unread && "border-l-2 border-accent")}>
                  <div className="flex items-baseline justify-between gap-3 pb-1">
                    <MessageLink
                      id={n.id}
                      href={href}
                      unread={n.unread}
                      className="t-body font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {n.title}
                    </MessageLink>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="t-label text-ink-3">
                        {NOTIFICATION_KIND_LABEL[n.kind]} · {new Date(n.created_at).toLocaleDateString()}
                      </span>
                      {n.unread ? <MarkRead id={n.id} /> : null}
                    </div>
                  </div>
                  <MessageLink
                    id={n.id}
                    href={href}
                    unread={n.unread}
                    className="block t-body-sm text-ink-2 transition-colors hover:text-ink"
                  >
                    {n.body}
                  </MessageLink>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
