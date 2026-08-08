import { describe, expect, it } from "vitest";

import {
  assertCanonicalContractYaml,
  formatCanonicalContractYaml,
  isCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";
import { sampleContract } from "./test-fixtures";

describe("canonical YAML subset", () => {
  it("round-trips byte-for-byte under the subset", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    expect(parseCanonicalContractYaml(yaml)).toEqual(sampleContract());
    expect(formatCanonicalContractYaml(parseCanonicalContractYaml(yaml))).toBe(
      yaml,
    );
    expect(isCanonicalContractYaml(yaml)).toBe(true);
  });

  it('keeps "123" as a string', () => {
    const c = sampleContract({ title: "123" });
    const yaml = formatCanonicalContractYaml(c);
    expect(yaml).toContain('title: "123"');
    expect(parseCanonicalContractYaml(yaml).title).toBe("123");
    expect(typeof parseCanonicalContractYaml(yaml).title).toBe("string");
  });

  it("quotes strings beginning with YAML indicators", () => {
    for (const title of ["@operator", "*x", "&anchor", "!tag", "#comment", "-dash", "?q", ":colon"]) {
      const yaml = formatCanonicalContractYaml(sampleContract({ title }));
      expect(yaml).toContain(`title: ${JSON.stringify(title)}`);
      expect(parseCanonicalContractYaml(yaml).title).toBe(title);
    }
  });

  it("preserves colon-containing and whitespace strings", () => {
    const title = " a:b ";
    const yaml = formatCanonicalContractYaml(sampleContract({ title }));
    expect(parseCanonicalContractYaml(yaml).title).toBe(title);
  });

  it("preserves quotes/backslashes/newlines via JSON encoding", () => {
    const title = 'say "hi"\\\nnext';
    const yaml = formatCanonicalContractYaml(sampleContract({ title }));
    expect(parseCanonicalContractYaml(yaml).title).toBe(title);
  });

  it("rejects invalid single-quoted input", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    const tweaked = yaml.replace('title: "Phase A sample"', "title: 'Phase A sample'");
    expect(() => parseCanonicalContractYaml(tweaked)).toThrow(/double-quoted/);
    expect(isCanonicalContractYaml(tweaked)).toBe(false);
  });

  it("rejects invalid boolean spelling", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    const tweaked = yaml.replace(
      "may_draft_migration_sql: false",
      "may_draft_migration_sql: False",
    );
    expect(() => parseCanonicalContractYaml(tweaked)).toThrow(/boolean/);
  });

  it("rejects noncanonical bare strings", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    const tweaked = yaml.replace('title: "Phase A sample"', "title: Phase A sample");
    expect(() => parseCanonicalContractYaml(tweaked)).toThrow(/double-quoted/);
    expect(() => assertCanonicalContractYaml(tweaked)).toThrow();
  });

  it("canonical-form assertion rejects equivalent noncanonical YAML", () => {
    const yaml = formatCanonicalContractYaml(sampleContract());
    // Same string value via JSON unicode escape — parses, but not frozen canonical bytes
    const tweaked = yaml.replace(
      'title: "Phase A sample"',
      'title: "Phase \\u0041 sample"',
    );
    expect(parseCanonicalContractYaml(tweaked).title).toBe("Phase A sample");
    expect(() => assertCanonicalContractYaml(tweaked)).toThrow(/canonical/);
  });
});
