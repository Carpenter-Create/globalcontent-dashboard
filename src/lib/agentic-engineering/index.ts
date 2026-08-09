/**
 * Public agentic-engineering surface (Phase A/B/C).
 * No raw Git tree/ref mutation and no privileged commit escape hatches.
 */

export * from "./authorize-binding";
export * from "./authorize-comment";
export * from "./canonical-json";
export * from "./closure-readiness";
export * from "./contract-digest";
export * from "./contract-schema";
export * from "./contract-yaml";
export {
  appendControlEvent,
  stageContract,
  addDerivedClosure,
  readTaskEventChain,
  type AppendEventInput,
  type AppendEventSuccess,
  type StageContractInput,
  type AddDerivedClosureInput,
  type LedgerIssue,
  type LedgerResult,
} from "./control-ledger";
export * from "./control-paths";
export {
  EMPTY_CONTROL_TIP,
  LedgerIntegrityError,
  tipForObjects,
  assertControlPaths,
  cloneObjects,
  contentDigestMap,
  type ControlTip,
  type ControlObjects,
  type ControlSnapshot,
  type ControlStore,
  type CasResult,
  type CasFailureCode,
} from "./control-store";
export * from "./control-bootstrap";
export { runAeControlCli, type RunControlCliOptions } from "./control-cli";
export * from "./control-github-allowlist";
export {
  readControlBranch,
  readControlBranchAtTip,
  type ControlBranchRead,
  type ControlReadResult,
} from "./control-github-read";
export { openGitHubControlStore } from "./control-github-store";
export * from "./dry-run-cli";
export * from "./event-chain";
export * from "./event-digest";
export * from "./event-schema";
export {
  openFilesystemLedger,
  LEDGER_MARKER_NAME,
  LEDGER_TIP_NAME,
  LEDGER_LOCK_NAME,
  LEDGER_OBJECTS_DIR,
  LEDGER_OBJECTS_NEXT_DIR,
  LEDGER_OBJECTS_PREV_DIR,
  LEDGER_TIP_NEXT_NAME,
  LEDGER_MARKER_CONTENTS,
  type OpenFilesystemLedgerOptions,
  type OpenFilesystemLedgerFailure,
  type OpenFilesystemLedgerResult,
} from "./filesystem-control-store";
export * from "./founder-events";
export * from "./genesis";
export * from "./github-boundary";
export * from "./github-config";
export {
  loadGitHubCredentialFromEnv,
  redactSecrets,
  type GitHubCredential,
  type GitHubCredentialClass,
} from "./github-credentials";
export { createFetchGitHubTransport, type GitHubTransport } from "./github-http";
export { GitHubRestClient } from "./github-rest";
export * from "./json-safe";
export {
  verifyLiveFounderAuthorization,
  liveAuthorizeAndFreeze,
  type VerifiedFounderAuthorization,
  type LiveAuthorizeExpectations,
} from "./live-founder-authorization";
export { LiveGitHubBoundaryClient } from "./live-github-boundary";
export { createMemoryControlStore } from "./memory-control-store";
export * from "./pr-evidence";
export * from "./privileged-events";
export * from "./protection-preflight";
export * from "./protected-delta";
export * from "./reconstruct-state";
export * from "./sha-pin-events";
export * from "./state-fold";
