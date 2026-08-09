import { AE_GITHUB_TOKEN_ENV } from "./github-config";

export type GitHubCredentialClass = "read" | "control_writer";

export type GitHubCredential = {
  /** Opaque bearer token — never log. */
  authorizationHeader: string;
  credentialClass: GitHubCredentialClass;
  /** Human label only (e.g. "env:AE_GITHUB_TOKEN") — never the secret. */
  sourceLabel: string;
};

export type CredentialResult =
  | { ok: true; credential: GitHubCredential }
  | { ok: false; code: string; message: string };

/**
 * Load bearer credential from process env.
 * Preferred production shape: GitHub App installation token minted out-of-band
 * and exported as AE_GITHUB_TOKEN. Fine-grained PAT is the documented fallback.
 * Classic PATs are not recommended.
 */
export function loadGitHubCredentialFromEnv(
  credentialClass: GitHubCredentialClass,
  env: NodeJS.ProcessEnv = process.env,
): CredentialResult {
  const token = env[AE_GITHUB_TOKEN_ENV];
  if (typeof token !== "string" || token.trim() === "") {
    return {
      ok: false,
      code: "credential_missing",
      message: `${AE_GITHUB_TOKEN_ENV} is required for live GitHub ${credentialClass} operations`,
    };
  }
  if (token.length < 10) {
    return {
      ok: false,
      code: "credential_invalid",
      message: `${AE_GITHUB_TOKEN_ENV} appears invalid`,
    };
  }
  return {
    ok: true,
    credential: {
      authorizationHeader: `Bearer ${token.trim()}`,
      credentialClass,
      sourceLabel: `env:${AE_GITHUB_TOKEN_ENV}`,
    },
  };
}

/** Redact anything that looks like a token from error/log strings. */
export function redactSecrets(text: string, tokenHint?: string): string {
  let out = text;
  if (tokenHint && tokenHint.length >= 8) {
    out = out.split(tokenHint).join("[REDACTED]");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]");
  out = out.replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]");
  out = out.replace(/ghs_[A-Za-z0-9]+/g, "[REDACTED]");
  return out;
}
