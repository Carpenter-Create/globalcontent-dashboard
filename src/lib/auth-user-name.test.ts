import { describe, expect, it } from "vitest";

import { resolveAuthUserName } from "./auth-user-name";

describe("resolveAuthUserName", () => {
  it("returns a real OIDC name claim that is not the email", () => {
    expect(
      resolveAuthUserName({ name: "Ada Lovelace", email: "ada@example.com" }),
    ).toBe("Ada Lovelace");
    expect(
      resolveAuthUserName({ name: "  Ada Lovelace  ", email: "ada@example.com" }),
    ).toBe("Ada Lovelace");
  });

  it("accepts user_metadata.full_name or user_metadata.name when present", () => {
    expect(
      resolveAuthUserName({
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      }),
    ).toBe("Ada Lovelace");
    expect(
      resolveAuthUserName({
        email: "ada@example.com",
        user_metadata: { name: "Ada Lovelace" },
      }),
    ).toBe("Ada Lovelace");
  });

  it("ignores user_metadata.display_name — that field is the org-name mirror", () => {
    expect(
      resolveAuthUserName({
        email: "jane@acmefilms.com",
        user_metadata: { display_name: "Acme Films" },
      }),
    ).toBeNull();
  });

  it("returns null when the claim is empty, whitespace, or the email itself", () => {
    expect(resolveAuthUserName({ email: "ada@example.com" })).toBeNull();
    expect(resolveAuthUserName({ name: "", email: "ada@example.com" })).toBeNull();
    expect(resolveAuthUserName({ name: "   ", email: "ada@example.com" })).toBeNull();
    expect(
      resolveAuthUserName({ name: "ada@example.com", email: "ada@example.com" }),
    ).toBeNull();
    expect(
      resolveAuthUserName({
        email: "ada@example.com",
        user_metadata: { full_name: "ada@example.com" },
      }),
    ).toBeNull();
  });

  it("does not invent a name from the email local-part", () => {
    expect(resolveAuthUserName({ email: "jane.doe@studio.com" })).toBeNull();
    expect(resolveAuthUserName({ email: "adam.carpenter@ccbfg.com" })).toBeNull();
  });
});
