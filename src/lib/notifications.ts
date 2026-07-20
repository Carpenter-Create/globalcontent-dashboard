// Notification copy + labels (§20 GC-Support in-app push). Copy in lib/, not JSX.

export const NOTIFICATION_KIND_LABEL: Record<"title_rejected" | "delivery_update", string> = {
  title_rejected: "Title returned",
  delivery_update: "Delivery update",
};

export const MESSAGES_EMPTY = "No messages yet.";
export const MESSAGES_SUBTITLE = "Updates from Global Content.";
