// Notification copy + labels (§20 GC-Support in-app push). Copy in lib/, not JSX.

export const NOTIFICATION_KIND_LABEL: Record<"title_rejected" | "delivery_update", string> = {
  title_rejected: "Title returned",
  delivery_update: "Delivery update",
};

// Email copy for the GC-Support channel (draft — revise here). The email body reuses the
// in-app notification body; this defines the per-kind subject, the CTA label, and where the
// CTA deep-links in the dashboard.
export const NOTIFICATION_EMAIL: Record<
  "title_rejected" | "delivery_update",
  { subject: (ctx: { title: string }) => string; cta: string; path: (ctx: { titleId?: string }) => string }
> = {
  title_rejected: {
    subject: ({ title }) => `"${title}" was returned for revision`,
    cta: "Review and resubmit",
    path: ({ titleId }) => (titleId ? `/titles/${titleId}` : "/messages"),
  },
  delivery_update: {
    subject: ({ title }) => `"${title}" — delivery update`,
    cta: "View your deliveries",
    path: () => "/deliveries",
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
