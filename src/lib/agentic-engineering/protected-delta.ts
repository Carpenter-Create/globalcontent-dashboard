export type ProtectedObjectMap = ReadonlyMap<string, string>;

export type ProtectedDeltaIssue = {
  code: string;
  path: string;
  message: string;
};

export type ProtectedDeltaResult =
  | { ok: true }
  | { ok: false; issues: ProtectedDeltaIssue[] };

function isProtectedAuthorityPath(path: string): boolean {
  return (
    path.startsWith("contracts/") ||
    path.startsWith("events/")
  );
}

function isDerivedPath(path: string): boolean {
  return path.startsWith("closures/") || path.startsWith("proposed/");
}

/**
 * Pure create-once verifier for conceptual protected object sets (spec §4.5.2).
 *
 * - `contracts/**` and `events/**` may only be added, never modified/deleted/renamed
 * - rename-as-delete+add is rejected (deleted protected path)
 * - `closures/**` and `proposed/**` may change (non-authority)
 */
export function verifyProtectedObjectDelta(
  prior: ProtectedObjectMap,
  next: ProtectedObjectMap,
): ProtectedDeltaResult {
  const issues: ProtectedDeltaIssue[] = [];

  for (const [path, digest] of prior) {
    if (!isProtectedAuthorityPath(path)) continue;
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

  for (const path of next.keys()) {
    if (isProtectedAuthorityPath(path) || isDerivedPath(path)) continue;
    // Unknown top-level areas are rejected for orchestrator deltas in later phases;
    // Phase A only validates the create-once invariant on known protected prefixes.
    void path;
  }

  // Detect rename: a prior protected digest reappearing at a new protected path while
  // the old path is gone — already covered as delete; also flag digest relocation.
  for (const [oldPath, oldDigest] of prior) {
    if (!isProtectedAuthorityPath(oldPath)) continue;
    if (next.has(oldPath)) continue;
    for (const [newPath, newDigest] of next) {
      if (!isProtectedAuthorityPath(newPath)) continue;
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

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}
