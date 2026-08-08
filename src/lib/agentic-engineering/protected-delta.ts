import {
  isAuthorityPath,
  isDerivedPath,
  parseControlPath,
} from "./control-paths";

export type ProtectedObjectMap = ReadonlyMap<string, string>;

export type ProtectedDeltaIssue = {
  code: string;
  path: string;
  message: string;
};

export type ProtectedDeltaResult =
  | { ok: true }
  | { ok: false; issues: ProtectedDeltaIssue[] };

/**
 * Pure create-once verifier for conceptual protected object sets (spec §4.5.2).
 * All paths must match strict control-plane grammar; unknown classes fail closed.
 */
export function verifyProtectedObjectDelta(
  prior: ProtectedObjectMap,
  next: ProtectedObjectMap,
): ProtectedDeltaResult {
  const issues: ProtectedDeltaIssue[] = [];

  for (const path of new Set([...prior.keys(), ...next.keys()])) {
    const parsed = parseControlPath(path);
    if (!parsed.ok) {
      issues.push({
        code: "invalid_path",
        path,
        message: `invalid control path: ${parsed.reason}`,
      });
    }
  }

  for (const [path, digest] of prior) {
    if (!isAuthorityPath(path)) continue;
    if (!next.has(path)) {
      issues.push({
        code: "protected_deleted",
        path,
        message: `protected path deleted: ${path}`,
      });
      continue;
    }
    if (next.get(path) !== digest) {
      issues.push({
        code: "protected_modified",
        path,
        message: `protected path modified/replaced: ${path}`,
      });
    }
  }

  for (const [oldPath, oldDigest] of prior) {
    if (!isAuthorityPath(oldPath)) continue;
    if (next.has(oldPath)) continue;
    for (const [newPath, newDigest] of next) {
      if (!isAuthorityPath(newPath)) continue;
      if (prior.has(newPath)) continue;
      if (newDigest === oldDigest) {
        issues.push({
          code: "protected_renamed",
          path: oldPath,
          message: `protected path rename detected: ${oldPath} -> ${newPath}`,
        });
      }
    }
  }

  // Derived paths may change; still must be grammatically valid (checked above).
  for (const path of next.keys()) {
    if (isAuthorityPath(path) || isDerivedPath(path)) continue;
    // invalid_path already recorded
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}
