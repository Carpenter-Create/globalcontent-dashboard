import { describe, expect, it } from "vitest";

import { parseAuthorizeComment } from "./authorize-comment";
import { SAMPLE_DIGEST, SAMPLE_SHA } from "./test-fixtures";

const valid = [
  "AE-AUTHORIZE",
  "task_id: AE-0001",
  "contract_version: 1",
  `contract_digest: ${SAMPLE_DIGEST}`,
  `base_sha: ${SAMPLE_SHA}`,
].join("\n");

describe("parseAuthorizeComment", () => {
  it("parses a valid exact comment", () => {
    const r = parseAuthorizeComment(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.task_id).toBe("AE-0001");
      expect(r.value.contract_version).toBe(1);
      expect(r.value.base_sha).toBe(SAMPLE_SHA);
    }
  });

  it("accepts CRLF line endings", () => {
    const r = parseAuthorizeComment(valid.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
  });

  it("rejects trailing free text", () => {
    const r = parseAuthorizeComment(`${valid}\nplease approve`);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate fields", () => {
    const r = parseAuthorizeComment(`${valid}\ntask_id: AE-0002`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /duplicate/.test(e))).toBe(true);
  });

  it("rejects unknown fields", () => {
    const r = parseAuthorizeComment(`${valid}\nactor: founder`);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed digest", () => {
    const bad = valid.replace(SAMPLE_DIGEST, "sha256:deadbeef");
    expect(parseAuthorizeComment(bad).ok).toBe(false);
  });

  it("rejects uppercase hex in digest", () => {
    const upper =
      "sha256:" + "A".repeat(64);
    const body = [
      "AE-AUTHORIZE",
      "task_id: AE-0001",
      "contract_version: 1",
      `contract_digest: ${upper}`,
      `base_sha: ${SAMPLE_SHA}`,
    ].join("\n");
    expect(parseAuthorizeComment(body).ok).toBe(false);
  });

  it("rejects bad base_sha", () => {
    const body = valid.replace(SAMPLE_SHA, "zzz");
    expect(parseAuthorizeComment(body).ok).toBe(false);
  });

  it("rejects missing line", () => {
    const lines = valid.split("\n").filter((l) => !l.startsWith("base_sha"));
    expect(parseAuthorizeComment(lines.join("\n")).ok).toBe(false);
  });

  it("rejects wrong header", () => {
    expect(parseAuthorizeComment(valid.replace("AE-AUTHORIZE", "AUTHORIZE")).ok).toBe(
      false,
    );
  });
});
