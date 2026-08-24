import { describe, expect, it } from "vitest";

import {
  ACCOUNT_NAME_MAX,
  ACCOUNT_PROFILE,
  COMPANY_PROFILE,
  accountNameSchema,
  authDisplayName,
  companySaveSchema,
} from "./account-profile";
import { USER_MENU, userMenuName } from "./user-menu";
import { ACCOUNT_SHEET } from "./account-sheet";

describe("account profile copy", () => {
  it("keeps User Profile and Company Profile titles, no banned voice", () => {
    expect(ACCOUNT_PROFILE.title).toBe("User Profile");
    expect(ACCOUNT_PROFILE.href).toBe("/account");
    expect(ACCOUNT_PROFILE.href).not.toBe("/account/profile");
    expect(COMPANY_PROFILE.title).toBe("Company Profile");
    expect(COMPANY_PROFILE.href).toBe("/account/company");
    expect(ACCOUNT_PROFILE.href).toBe(USER_MENU.userProfileHref);
    expect(ACCOUNT_PROFILE.href).toBe(ACCOUNT_SHEET.manageHref);
    expect(COMPANY_PROFILE.href).toBe(USER_MENU.companyProfileHref);
    expect(COMPANY_PROFILE.href).toBe(ACCOUNT_SHEET.companyHref);
    const blob = `${ACCOUNT_PROFILE.subtitle} ${COMPANY_PROFILE.subtitle}`;
    expect(blob).not.toMatch(/seamless|frictionless|elevate|amplify|unleash|supercharge/i);
  });
});

describe("account name schemas", () => {
  it("trims display names, allows empty, and rejects oversized or non-string values", () => {
    expect(accountNameSchema.parse("  Ada  ")).toBe("Ada");
    expect(accountNameSchema.parse("   ")).toBe("");
    expect(accountNameSchema.safeParse("x".repeat(ACCOUNT_NAME_MAX + 1)).success).toBe(false);
    expect(accountNameSchema.safeParse(12).success).toBe(false);
  });

  it("requires a company name and the rendered org id", () => {
    expect(
      companySaveSchema.parse({
        orgId: "11111111-1111-4111-8111-111111111111",
        name: "  Acme  ",
      }),
    ).toEqual({
      orgId: "11111111-1111-4111-8111-111111111111",
      name: "Acme",
    });
    expect(
      companySaveSchema.safeParse({
        orgId: "11111111-1111-4111-8111-111111111111",
        name: "   ",
      }).success,
    ).toBe(false);
    expect(companySaveSchema.safeParse({ orgId: "not-a-uuid", name: "Acme" }).success).toBe(false);
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
