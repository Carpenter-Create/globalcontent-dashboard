import { createHash } from "node:crypto";

import { sha256DigestSchema, type TaskContract } from "./contract-schema";
import {
  assertCanonicalContractYaml,
  formatCanonicalContractYaml,
} from "./contract-yaml";

/**
 * Contract digest binds **exact frozen UTF-8 file bytes** after canonical-form
 * enforcement (spec §6.5 approach A).
 *
 * Do not re-serialize with a different YAML library and expect the same digest.
 */

export function digestUtf8Bytes(bytes: string | Buffer): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const hex = createHash("sha256").update(buf).digest("hex");
  return sha256DigestSchema.parse(`sha256:${hex}`);
}

/** Hash canonical YAML bytes; rejects non-canonical input. */
export function digestContractFileBytes(fileUtf8: string): string {
  assertCanonicalContractYaml(fileUtf8);
  return digestUtf8Bytes(fileUtf8);
}

/** Convenience: validate contract, emit canonical YAML, digest those bytes. */
export function digestTaskContract(contract: TaskContract): {
  yaml: string;
  digest: string;
} {
  const yaml = formatCanonicalContractYaml(contract);
  return { yaml, digest: digestContractFileBytes(yaml) };
}
