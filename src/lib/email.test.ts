import { describe, expect, it } from "vitest";
import { buildOtpEmail } from "./email";

describe("buildOtpEmail", () => {
  it("includes the code and no banned words", () => {
    const { subject, text, html } = buildOtpEmail("012345");
    expect(text).toContain("012345");
    expect(html).toContain("012345");
    expect(subject.toLowerCase()).not.toMatch(/seamless|frictionless|elevate|amplify/);
    expect(text).toMatch(/10 minutes/);
  });
});
