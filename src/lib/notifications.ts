// Notification copy + labels (§20 GC-Support in-app push). Copy in lib/, not JSX.

export const NOTIFICATION_KIND_LABEL: Record<"title_rejected" | "delivery_update", string> = {
  title_rejected: "Title returned",
  delivery_update: "Delivery update",
};

export type NotificationLinkCtx = { titleId?: string };

export type NotificationKind = "title_rejected" | "delivery_update";

export type NotificationLink = { cta: string; path: string };

export type NotificationEmailCopy = {
  subject: (ctx: { title: string }) => string;
  /** Paired CTA + path for the supplied context — the sender-facing deep-link API. */
  link: (ctx?: NotificationLinkCtx) => NotificationLink;
  /** Path-only convenience for the Messages inbox; always delegates to `link`. */
  path: (ctx?: NotificationLinkCtx) => string;
};

// titleId for delivery_update may arrive from untrusted source_refs — only a canonical
// UUID may be interpolated into a title path. title_rejected keeps the pre-existing
// truthy-titleId contract (no UUID hardening).
const TITLE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSafeTitleId(titleId: string | undefined): titleId is string {
  return typeof titleId === "string" && TITLE_ID_RE.test(titleId);
}

function deliveryUpdateLink(ctx: NotificationLinkCtx = {}): NotificationLink {
  if (isSafeTitleId(ctx.titleId)) {
    return { cta: "View title", path: `/titles/${ctx.titleId}` };
  }
  return { cta: "View your deliveries", path: "/deliveries" };
}

function titleRejectedLink(ctx: NotificationLinkCtx = {}): NotificationLink {
  return {
    cta: "Review and resubmit",
    // Pre-existing contract: any truthy titleId deep-links; otherwise /messages.
    path: ctx.titleId ? `/titles/${ctx.titleId}` : "/messages",
  };
}

// Email copy for the GC-Support channel (draft — revise here). The email body reuses the
// in-app notification body; `link` defines the per-kind CTA label and dashboard deep-link
// as one paired result. Messages inbox uses `path` (delegates to `link`). There is no
// independent static CTA that can drift from the destination.
export const NOTIFICATION_EMAIL: Record<NotificationKind, NotificationEmailCopy> = {
  title_rejected: {
    subject: ({ title }) => `"${title}" was returned for revision`,
    link: titleRejectedLink,
    path: (ctx = {}) => titleRejectedLink(ctx).path,
  },
  delivery_update: {
    subject: ({ title }) => `"${title}" — delivery update`,
    link: deliveryUpdateLink,
    path: (ctx = {}) => deliveryUpdateLink(ctx).path,
  },
};

// Client-facing labels for delivery statuses — never surface the raw snake_case enum
// in a notice (voice governs UI copy).
export const DELIVERY_STATUS_LABELS: Record<
  "pending" | "delivered" | "live" | "rejected" | "taken_down",
  string
> = {
  pending: "pending",
  delivered: "delivered",
  live: "live",
  rejected: "rejected",
  taken_down: "taken down",
};

export const MESSAGES_EMPTY = "No messages yet.";
export const MESSAGES_SUBTITLE = "Updates from Global Content.";
