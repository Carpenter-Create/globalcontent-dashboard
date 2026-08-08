import { gitShaSchema, sha256DigestSchema } from "./contract-schema";

export type AuthorizeComment = {
  task_id: string;
  contract_version: number;
  contract_digest: string;
  base_sha: string;
};

export type AuthorizeParseResult =
  | { ok: true; value: AuthorizeComment }
  | { ok: false; errors: string[] };

const REQUIRED_KEYS = [
  "task_id",
  "contract_version",
  "contract_digest",
  "base_sha",
] as const;

/**
 * Pure parser for the exact founder AE-AUTHORIZE comment grammar (spec §5.2).
 * Does not verify GitHub actor identity (later phase).
 *
 * - Normalizes CRLF/CR to LF for splitting
 * - Exact header `AE-AUTHORIZE`
 * - Required fields exactly once; unknown fields rejected
 * - No blank lines / trailing free text
 * - Terminal newline: none, or exactly one (additional blank lines rejected)
 * - `key: value` with exactly one space after colon
 * - `contract_version` must be a positive safe integer
 */
export function parseAuthorizeComment(body: string): AuthorizeParseResult {
  const errors: string[] = [];
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Allow no final newline, or exactly one. Reject additional trailing blank lines.
  let text = normalized;
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  const lines = text.split("\n");
  if (lines.some((line) => line === "")) {
    return { ok: false, errors: ["blank lines are not allowed"] };
  }

  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { ok: false, errors: ["empty comment"] };
  }
  if (lines[0] !== "AE-AUTHORIZE") {
    return { ok: false, errors: ["first line must be exactly AE-AUTHORIZE"] };
  }

  const seen = new Map<string, string>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^([a-z_]+): (.+)$/.exec(line);
    if (!m || line.endsWith(" ")) {
      errors.push(
        `line ${i + 1}: expected "key: value" with one space after ':' and no trailing text/spaces`,
      );
      continue;
    }
    const [, key, value] = m;
    if (seen.has(key)) {
      errors.push(`duplicate field: ${key}`);
      continue;
    }
    if (!(REQUIRED_KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown field: ${key}`);
      continue;
    }
    seen.set(key, value);
  }

  for (const key of REQUIRED_KEYS) {
    if (!seen.has(key)) errors.push(`missing field: ${key}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const task_id = seen.get("task_id")!;
  if (!/^AE-[0-9]{4,}$/.test(task_id)) {
    errors.push("task_id must match AE-#### (+)");
  }

  const versionRaw = seen.get("contract_version")!;
  if (!/^[1-9][0-9]*$/.test(versionRaw)) {
    errors.push("contract_version must be a positive integer");
  }
  const contract_version = Number(versionRaw);
  if (
    !Number.isSafeInteger(contract_version) ||
    contract_version < 1 ||
    String(contract_version) !== versionRaw
  ) {
    errors.push("contract_version must be a positive safe integer");
  }

  const digestParse = sha256DigestSchema.safeParse(seen.get("contract_digest"));
  if (!digestParse.success) {
    errors.push("contract_digest must be sha256: + 64 lowercase hex");
  }

  const shaParse = gitShaSchema.safeParse(seen.get("base_sha"));
  if (!shaParse.success) {
    errors.push("base_sha must be 40 lowercase hex characters");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      task_id,
      contract_version,
      contract_digest: digestParse.data!,
      base_sha: shaParse.data!,
    },
  };
}
