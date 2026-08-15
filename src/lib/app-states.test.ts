import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AppError from "@/app/error";
import AppNotFound from "@/app/not-found";
import DashboardError from "@/app/(app)/error";
import DashboardNotFound from "@/app/(app)/not-found";

import {
  APP_ERROR,
  APP_NOT_FOUND,
  LOGIN_AUTH_ERROR,
  loginAuthErrorNotice,
} from "./app-states";

const LEAK_KEYS = ["message", "digest", "error", "stack"] as const;

describe("loginAuthErrorNotice", () => {
  it("returns the approved notice only for the exact auth token", () => {
    expect(loginAuthErrorNotice("auth")).toBe(LOGIN_AUTH_ERROR);
    expect(LOGIN_AUTH_ERROR).toBe(
      "That sign-in link is no longer valid. Request a new one.",
    );
  });

  it("stays silent for missing, empty, or any other query value", () => {
    expect(loginAuthErrorNotice(undefined)).toBeNull();
    expect(loginAuthErrorNotice(null)).toBeNull();
    expect(loginAuthErrorNotice("")).toBeNull();
    expect(loginAuthErrorNotice("expired")).toBeNull();
    expect(loginAuthErrorNotice("AUTH")).toBeNull();
    expect(loginAuthErrorNotice(["auth"])).toBeNull();
    expect(loginAuthErrorNotice({ error: "auth" })).toBeNull();
  });

  it("never echoes the raw query value", () => {
    expect(loginAuthErrorNotice("auth")).not.toBe("auth");
    expect(loginAuthErrorNotice("<script>alert(1)</script>")).toBeNull();
  });
});

describe("application state copy", () => {
  it("exposes the approved not-found and error copy with a dashboard home link", () => {
    expect(APP_NOT_FOUND).toEqual({
      title: "This page isn't available.",
      description: "The link may be incorrect, or the page may no longer be here.",
      homeHref: "/",
      homeLabel: "Go to dashboard",
    });
    expect(APP_ERROR).toEqual({
      title: "Something went wrong.",
      description: "Try again, or return to the dashboard.",
      homeHref: "/",
      homeLabel: "Go to dashboard",
      retryLabel: "Try again",
    });
  });

  it("does not carry error payloads that pages could accidentally render", () => {
    for (const view of [APP_NOT_FOUND, APP_ERROR]) {
      for (const key of LEAK_KEYS) {
        expect(view).not.toHaveProperty(key);
      }
    }
  });
});

function visibleText(html: string): string {
  return html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

function pageHeadings(html: string): string[] {
  return [...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((match) =>
    visibleText(match[1]),
  );
}

describe("application error and not-found pages", () => {
  const leaked = {
    message: "secret-internal-message",
    digest: "SECRET_DIGEST_9f3",
  };

  it("root and dashboard not-found pages render approved copy and the home href", () => {
    for (const Page of [AppNotFound, DashboardNotFound]) {
      const html = renderToStaticMarkup(createElement(Page));
      const text = visibleText(html);
      expect(text).toContain(APP_NOT_FOUND.title);
      expect(text).toContain(APP_NOT_FOUND.description);
      expect(text).toContain(APP_NOT_FOUND.homeLabel);
      expect(pageHeadings(html)).toEqual([APP_NOT_FOUND.title]);
      expect(html.match(/<h1 class="sr-only">/g)).toHaveLength(1);
      expect(html).toContain(`href="${APP_NOT_FOUND.homeHref}"`);
      expect(html).not.toContain("/gc/deliveries");
      expect(html).not.toContain("/queue");
    }
  });

  it("root and dashboard error pages render approved copy and never leak the error object", () => {
    for (const Page of [AppError, DashboardError]) {
      const html = renderToStaticMarkup(
        createElement(Page, {
          error: Object.assign(new Error(leaked.message), { digest: leaked.digest }),
          reset: () => undefined,
        }),
      );
      const text = visibleText(html);
      expect(text).toContain(APP_ERROR.title);
      expect(text).toContain(APP_ERROR.description);
      expect(text).toContain(APP_ERROR.retryLabel);
      expect(text).toContain(APP_ERROR.homeLabel);
      expect(pageHeadings(html)).toEqual([APP_ERROR.title]);
      expect(html.match(/<h1 class="sr-only">/g)).toHaveLength(1);
      expect(html).toContain(`href="${APP_ERROR.homeHref}"`);
      expect(html).not.toContain(leaked.message);
      expect(html).not.toContain(leaked.digest);
    }
  });
});
