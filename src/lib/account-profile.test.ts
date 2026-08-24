import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PROFILE,
  COMPANY_PROFILE,
  authDisplayName,
  canEditCompanyProfile,
} from "./account-profile";
import { userMenuName } from "./user-menu";

describe("account profile copy", () => {
  it("keeps User Profile and Company Profile titles, no banned voice", () => {
    expect(ACCOUNT_PROFILE.title).toBe("User Profile");
    expect(COMPANY_PROFILE.title).toBe("Company Profile");
    expect(COMPANY_PROFILE.href).toBe("/account/company");
    const blob = `${ACCOUNT_PROFILE.subtitle} ${COMPANY_PROFILE.subtitle}`;
    expect(blob).not.toMatch(/seamless|frictionless|elevate|amplify|unleash|supercharge/i);
  });
});

describe("authDisplayName", () => {
  it("reads user_metadata.display_name and trims", () => {
    expect(authDisplayName({ user_metadata: { display_name: "  Ada Lovelace  " } })).toBe(
      "Ada Lovelace",
    );
    expect(authDisplayName({ user_metadata: { display_name: "Ada Lovelace" } })).toBe(
      userMenuName("Ada Lovelace"),
    );
  });

  it("stays empty when the field is missing or whitespace", () => {
    expect(authDisplayName({})).toBeNull();
    expect(authDisplayName({ user_metadata: {} })).toBeNull();
    expect(authDisplayName({ user_metadata: { display_name: "   " } })).toBeNull();
    expect(authDisplayName({ user_metadata: { display_name: "" } })).toBeNull();
    expect(authDisplayName(null)).toBeNull();
  });

  it("does not invent a name from the email local-part", () => {
    const email = "jane.doe@studio.com";
    expect(authDisplayName({ email, user_metadata: {} })).toBeNull();
    expect(authDisplayName({ email, user_metadata: { display_name: email.split("@")[0] } })).toBe(
      "jane.doe",
    );
    expect(authDisplayName({ email })).toBeNull();
    expect(authDisplayName({ display_name: "Should not read top-level" })).toBeNull();
  });
});

describe("canEditCompanyProfile", () => {
  it("is account_owner or GC staff only — not delivery_ops", () => {
    expect(canEditCompanyProfile("account_owner", false)).toBe(true);
    expect(canEditCompanyProfile("viewer", true)).toBe(true);
    expect(canEditCompanyProfile("delivery_ops", false)).toBe(false);
    expect(canEditCompanyProfile("viewer", false)).toBe(false);
    expect(canEditCompanyProfile(null, false)).toBe(false);
  });
});
