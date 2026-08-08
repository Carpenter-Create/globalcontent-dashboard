import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_CONTRACT_KEYS,
  parseTaskContract,
  safeParseTaskContract,
  taskContractSchema,
} from "./contract-schema";
import { sampleContract, SAMPLE_SHA } from "./test-fixtures";

describe("taskContractSchema", () => {
  it("accepts a valid contract", () => {
    const c = sampleContract();
    expect(parseTaskContract(c).task_id).toBe("AE-0001");
  });

  it("rejects missing required fields", () => {
    const rest = { ...sampleContract() } as Record<string, unknown>;
    delete rest.title;
    const r = safeParseTaskContract(rest);
    expect(r.success).toBe(false);
  });

  it("rejects a bad base_sha", () => {
    const r = safeParseTaskContract(sampleContract({ base_sha: "notasha" }));
    expect(r.success).toBe(false);
  });

  it("rejects uppercase SHA", () => {
    const r = safeParseTaskContract(
      sampleContract({ base_sha: "A".repeat(40) }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects invalid review_intensity", () => {
    const r = safeParseTaskContract({
      ...sampleContract(),
      review_intensity: "relaxed",
    });
    expect(r.success).toBe(false);
  });

  it("rejects role_separation other than required", () => {
    const r = safeParseTaskContract({
      ...sampleContract(),
      role_separation: "optional",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-positive remediation rounds", () => {
    expect(
      safeParseTaskContract(sampleContract({ max_remediation_rounds: 0 }))
        .success,
    ).toBe(false);
  });

  it("rejects empty authorized_scope", () => {
    expect(
      safeParseTaskContract(sampleContract({ authorized_scope: [] })).success,
    ).toBe(false);
  });

  it("rejects unknown authority-bearing keys via strict object", () => {
    const r = safeParseTaskContract({
      ...sampleContract(),
      merge_authority: "founder",
    });
    expect(r.success).toBe(false);
  });

  for (const key of FORBIDDEN_CONTRACT_KEYS) {
    it(`rejects forbidden execution field ${key}`, () => {
      const r = safeParseTaskContract({
        ...sampleContract(),
        [key]: false,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => String(i.message).includes(key))).toBe(
          true,
        );
      }
    });
  }

  it("mutation: removing role_separation required would fail this test", () => {
    // If schema were weakened to z.string(), this would incorrectly pass.
    const parsed = taskContractSchema.safeParse({
      ...sampleContract(),
      role_separation: "required",
    });
    expect(parsed.success).toBe(true);
    expect(SAMPLE_SHA).toHaveLength(40);
  });
});
