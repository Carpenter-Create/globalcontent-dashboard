import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";

export const DEFAULT_CONTROL_BRANCH = "ae/control";

/** Secret env var names only — never log values. */
export const AE_GITHUB_TOKEN_ENV = "AE_GITHUB_TOKEN";
export const AE_GITHUB_OWNER_ENV = "AE_GITHUB_OWNER";
export const AE_GITHUB_REPO_ENV = "AE_GITHUB_REPO";
export const AE_CONTROL_BRANCH_ENV = "AE_CONTROL_BRANCH";
export const AE_FOUNDER_ACTOR_ENV = "AE_FOUNDER_GITHUB_ACTOR_ID";

export type AgenticGitHubConfig = {
  owner: string;
  repo: string;
  controlBranch: string;
  founderActorId: number;
  /** API base; override only for tests. */
  apiBaseUrl: string;
  requestTimeoutMs: number;
};

export type LoadConfigResult =
  | { ok: true; config: AgenticGitHubConfig }
  | { ok: false; code: string; message: string };

/**
 * Load non-secret GitHub configuration from explicit overrides and/or env.
 * Does not read `.env` files — callers/process must inject env if needed.
 */
export function loadAgenticGitHubConfig(
  overrides: Partial<{
    owner: string;
    repo: string;
    controlBranch: string;
    founderActorId: number;
    apiBaseUrl: string;
    requestTimeoutMs: number;
  }> = {},
  env: NodeJS.ProcessEnv = process.env,
): LoadConfigResult {
  const owner = overrides.owner ?? env[AE_GITHUB_OWNER_ENV] ?? "";
  const repo = overrides.repo ?? env[AE_GITHUB_REPO_ENV] ?? "";
  const controlBranch =
    overrides.controlBranch ??
    env[AE_CONTROL_BRANCH_ENV] ??
    DEFAULT_CONTROL_BRANCH;
  const founderRaw =
    overrides.founderActorId ??
    (env[AE_FOUNDER_ACTOR_ENV]
      ? Number(env[AE_FOUNDER_ACTOR_ENV])
      : CONFIGURED_FOUNDER_GITHUB_ACTOR_ID);

  if (!owner || !repo) {
    return {
      ok: false,
      code: "config_missing_repo",
      message: `set ${AE_GITHUB_OWNER_ENV} and ${AE_GITHUB_REPO_ENV} (or pass owner/repo)`,
    };
  }
  if (
    controlBranch === "main" ||
    controlBranch === "master" ||
    controlBranch.includes("..") ||
    controlBranch.startsWith("/") ||
    controlBranch.endsWith("/") ||
    controlBranch.includes("//")
  ) {
    return {
      ok: false,
      code: "config_invalid_control_branch",
      message:
        "control branch must be a safe ref name (default ae/control); main/master rejected",
    };
  }
  if (
    typeof founderRaw !== "number" ||
    !Number.isSafeInteger(founderRaw) ||
    founderRaw < 1
  ) {
    return {
      ok: false,
      code: "config_invalid_founder",
      message: "founder actor ID must be a positive integer",
    };
  }
  if (founderRaw !== CONFIGURED_FOUNDER_GITHUB_ACTOR_ID) {
    return {
      ok: false,
      code: "config_founder_mismatch",
      message: `founder actor ID must be configured repository identity ${CONFIGURED_FOUNDER_GITHUB_ACTOR_ID}`,
    };
  }

  return {
    ok: true,
    config: {
      owner,
      repo,
      controlBranch,
      founderActorId: founderRaw,
      apiBaseUrl: overrides.apiBaseUrl ?? "https://api.github.com",
      requestTimeoutMs: overrides.requestTimeoutMs ?? 30_000,
    },
  };
}

export function repoFullName(config: AgenticGitHubConfig): string {
  return `${config.owner}/${config.repo}`;
}
