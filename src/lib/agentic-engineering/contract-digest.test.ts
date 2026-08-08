import { describe, expect, it } from "vitest";

import {
  digestContractFileBytes,
  digestTaskContract,
} from "./contract-digest";
import {
  formatCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";
import { sampleContract } from "./test-fixtures";

describe("contract digest / canonical YAML", () => {
  it("round-trips canonical YAML", () => {
    const c = sampleContract();
    const yaml = formatCanonicalContractYaml(c);
    expect(yaml.endsWith("\n")).toBe(true);
    expect(yaml.includes("\r")).toBe(false);
    const parsed = parseCanonicalContractYaml(yaml);
    expect(parsed).toEqual(c);
    expect(formatCanonicalContractYaml(parsed)).toBe(yaml);
  });

  it("digests exact frozen bytes deterministically", () => {
    const a = digestTaskContract(sampleContract());
    const b = digestTaskContract(sampleContract());
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestContractFileBytes(a.yaml)).toBe(a.digest);
  });

  it("rejects non-canonical bytes", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    const tweaked = yaml.replace("title: ", "title:  ");
    expect(() => digestContractFileBytes(tweaked)).toThrow(/canonical/);
  });

  it("changes digest when contract content changes", () => {
    const a = digestTaskContract(sampleContract({ title: "A" }));
    const b = digestTaskContract(sampleContract({ title: "B" }));
    expect(a.digest).not.toBe(b.digest);
  });
});
