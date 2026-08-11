import { describe, expect, it } from "vitest";

import { NOTIFICATION_EMAIL } from "./notifications";

const TITLE_ID = "aaaaaaaa-1111-4111-8111-111111111111";

describe("NOTIFICATION_EMAIL.delivery_update.link (sender-facing API)", () => {
  const { link, path, subject } = NOTIFICATION_EMAIL.delivery_update;

  it("pairs title path with View title when titleId is a valid UUID", () => {
    expect(link({ titleId: TITLE_ID })).toEqual({
      path: `/titles/${TITLE_ID}`,
      cta: "View title",
    });
    expect(link({ titleId: TITLE_ID.toUpperCase() })).toEqual({
      path: `/titles/${TITLE_ID.toUpperCase()}`,
      cta: "View title",
    });
  });

  it("pairs /deliveries with View your deliveries when titleId is absent", () => {
    expect(link({})).toEqual({ path: "/deliveries", cta: "View your deliveries" });
    expect(link()).toEqual({ path: "/deliveries", cta: "View your deliveries" });
  });

  it("pairs /deliveries with View your deliveries for unsafe titleId values", () => {
    for (const titleId of ["../admin", "not-a-uuid", `${TITLE_ID}/extra`, ""]) {
      expect(link({ titleId })).toEqual({
        path: "/deliveries",
        cta: "View your deliveries",
      });
    }
  });

  it("keeps path() identical to link().path (Messages convenience)", () => {
    expect(path({ titleId: TITLE_ID })).toBe(link({ titleId: TITLE_ID }).path);
    expect(path({})).toBe(link({}).path);
    expect(path({ titleId: "../admin" })).toBe(link({ titleId: "../admin" }).path);
  });

  it("preserves the delivery_update subject line", () => {
    expect(subject({ title: "North Wind" })).toBe('"North Wind" — delivery update');
  });
});

describe("NOTIFICATION_EMAIL.title_rejected.link (sender-facing API)", () => {
  const { link, path, subject } = NOTIFICATION_EMAIL.title_rejected;

  it("preserves subject, CTA, and truthy-titleId deep-link behavior", () => {
    expect(subject({ title: "North Wind" })).toBe('"North Wind" was returned for revision');
    expect(link({ titleId: TITLE_ID })).toEqual({
      cta: "Review and resubmit",
      path: `/titles/${TITLE_ID}`,
    });
    expect(link({})).toEqual({ cta: "Review and resubmit", path: "/messages" });
    expect(link()).toEqual({ cta: "Review and resubmit", path: "/messages" });
  });

  it("keeps the pre-existing truthy titleId contract (no UUID hardening)", () => {
    // Prior behavior: any truthy string was interpolated. Must not regress to UUID-only.
    expect(link({ titleId: "not-a-uuid" })).toEqual({
      cta: "Review and resubmit",
      path: "/titles/not-a-uuid",
    });
  });

  it("keeps path() identical to link().path", () => {
    expect(path({ titleId: TITLE_ID })).toBe(link({ titleId: TITLE_ID }).path);
    expect(path({})).toBe(link({}).path);
  });
});
