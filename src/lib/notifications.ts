// Notification copy + labels (§20 GC-Support in-app push). Copy in lib/, not JSX.

export const NOTIFICATION_KIND_LABEL: Record<"title_rejected" | "delivery_update", string> = {
  title_rejected: "Title returned",
  delivery_update: "Delivery update",
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
