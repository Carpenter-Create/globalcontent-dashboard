import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { NOTIFICATION_KIND_LABEL, MESSAGES_EMPTY, MESSAGES_SUBTITLE } from "@/lib/notifications";
import { MarkAllRead } from "./mark-all-read";
import { MarkRead } from "./mark-read";

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
          {list.map((n) => (
            <Card key={n.id}>
              <CardBody className={cn(n.unread && "border-l-2 border-accent")}>
                <div className="flex items-baseline justify-between gap-3 pb-1">
                  <span className="t-body font-medium text-ink">{n.title}</span>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="t-label text-ink-3">
                      {NOTIFICATION_KIND_LABEL[n.kind]} · {new Date(n.created_at).toLocaleDateString()}
                    </span>
                    {n.unread ? <MarkRead id={n.id} /> : null}
                  </div>
                </div>
                <p className="t-body-sm text-ink-2">{n.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
