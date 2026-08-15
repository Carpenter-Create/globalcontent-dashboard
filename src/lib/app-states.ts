export const LOGIN_AUTH_ERROR =
  "That sign-in link is no longer valid. Request a new one.";

/** Exact `error=auth` from /auth/callback — never echo or interpret any other value. */
export function loginAuthErrorNotice(error: unknown): string | null {
  return error === "auth" ? LOGIN_AUTH_ERROR : null;
}

export const APP_NOT_FOUND = {
  title: "This page isn't available.",
  description: "The link may be incorrect, or the page may no longer be here.",
  homeHref: "/",
  homeLabel: "Go to dashboard",
} as const;

export const APP_ERROR = {
  title: "Something went wrong.",
  description: "Try again, or return to the dashboard.",
  homeHref: "/",
  homeLabel: "Go to dashboard",
  retryLabel: "Try again",
} as const;
