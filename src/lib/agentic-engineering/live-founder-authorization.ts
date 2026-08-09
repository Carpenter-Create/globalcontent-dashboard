import { parseAuthorizeComment, type AuthorizeComment } from "./authorize-comment";
import { bindFounderAuthorization } from "./authorize-binding";
import type { AuthorizeBindingSuccess } from "./authorize-binding";
import type { LedgerResult } from "./control-ledger";
import type { ControlStore, ControlTip } from "./control-store";
import type { AgenticGitHubConfig } from "./github-config";
import { repoFullName } from "./github-config";
import type { GitHubRestClient } from "./github-rest";

export type LiveAuthorizeExpectations = {
  issueNumber: number;
  commentId: number;
  expectedTaskId: string;
  expectedContractVersion: number;
  expectedContractDigest: string;
  expectedBaseSha: string;
};

export type VerifiedFounderAuthorization = {
  repository: string;
  issueNumber: number;
  commentId: number;
  actorId: number;
  actorLogin: string;
  createdAt: string;
  updatedAt: string;
  /** Always "created" when verification succeeds (immutability gate). */
  commentAction: "created";
  body: string;
  parsed: AuthorizeComment;
};

export type LiveVerifyResult =
  | { ok: true; value: VerifiedFounderAuthorization }
  | { ok: false; code: string; message: string };

function issueNumberFromComment(urls: {
  issue_url?: string;
  html_url?: string;
}): number | null {
  if (urls.issue_url) {
    const m = /\/issues\/(\d+)(?:\?|$)/.exec(urls.issue_url);
    if (m) return Number(m[1]);
  }
  if (urls.html_url) {
    const m = /\/issues\/(\d+)(?:#|$)/.exec(urls.html_url);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Fetch a real Issue comment and verify founder authorization evidence.
 * Pasted comment text is not authoritative — body comes from GitHub only.
 */
export async function verifyLiveFounderAuthorization(
  client: GitHubRestClient,
  config: AgenticGitHubConfig,
  expectations: LiveAuthorizeExpectations,
): Promise<LiveVerifyResult> {
  const repo = await client.getRepository();
  if (!repo.ok) {
    return { ok: false, code: repo.code, message: repo.message };
  }
  const expectedFull = repoFullName(config);
  if (repo.data.full_name !== expectedFull) {
    return {
      ok: false,
      code: "wrong_repository",
      message: `expected repository ${expectedFull}, got ${repo.data.full_name}`,
    };
  }

  const comment = await client.getIssueComment(expectations.commentId);
  if (!comment.ok) {
    if (comment.code === "not_found") {
      return {
        ok: false,
        code: "missing_comment",
        message: `issue comment ${expectations.commentId} not found`,
      };
    }
    return { ok: false, code: comment.code, message: comment.message };
  }

  const issueNumber = issueNumberFromComment(comment.data);
  if (issueNumber === null) {
    return {
      ok: false,
      code: "issue_binding_unknown",
      message: "comment payload missing issue_url/html_url for issue binding",
    };
  }
  if (issueNumber !== expectations.issueNumber) {
    return {
      ok: false,
      code: "wrong_issue",
      message: `comment is on issue ${issueNumber}, expected ${expectations.issueNumber}`,
    };
  }

  if (comment.data.user.id !== config.founderActorId) {
    return {
      ok: false,
      code: "wrong_actor",
      message: `actor ${comment.data.user.id} != founder ${config.founderActorId}`,
    };
  }

  // v1 immutability: edited comments have updated_at > created_at.
  if (comment.data.created_at !== comment.data.updated_at) {
    return {
      ok: false,
      code: "edited_comment",
      message: "authorization comment appears edited (created_at != updated_at)",
    };
  }

  const parsed = parseAuthorizeComment(comment.data.body);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "authorize_comment_invalid",
      message: parsed.errors.join("; "),
    };
  }

  if (parsed.value.task_id !== expectations.expectedTaskId) {
    return {
      ok: false,
      code: "wrong_task",
      message: `task_id ${parsed.value.task_id} != expected ${expectations.expectedTaskId}`,
    };
  }
  if (parsed.value.contract_version !== expectations.expectedContractVersion) {
    return {
      ok: false,
      code: "wrong_version",
      message: `contract_version ${parsed.value.contract_version} != expected ${expectations.expectedContractVersion}`,
    };
  }
  if (parsed.value.contract_digest !== expectations.expectedContractDigest) {
    return {
      ok: false,
      code: "wrong_digest",
      message: `contract_digest mismatch`,
    };
  }
  if (parsed.value.base_sha !== expectations.expectedBaseSha) {
    return {
      ok: false,
      code: "wrong_base_sha",
      message: `base_sha mismatch`,
    };
  }

  return {
    ok: true,
    value: {
      repository: expectedFull,
      issueNumber,
      commentId: comment.data.id,
      actorId: comment.data.user.id,
      actorLogin: comment.data.user.login,
      createdAt: comment.data.created_at,
      updatedAt: comment.data.updated_at,
      commentAction: "created",
      body: comment.data.body,
      parsed: parsed.value,
    },
  };
}

/**
 * Live verify + Phase B bind/freeze against a writable control store (local or GitHub).
 */
export async function liveAuthorizeAndFreeze(input: {
  client: GitHubRestClient;
  config: AgenticGitHubConfig;
  store: ControlStore;
  expectedTip: ControlTip;
  expectations: LiveAuthorizeExpectations;
}): Promise<LedgerResult<AuthorizeBindingSuccess>> {
  const verified = await verifyLiveFounderAuthorization(
    input.client,
    input.config,
    input.expectations,
  );
  if (!verified.ok) {
    return {
      ok: false,
      issues: [{ code: verified.code, message: verified.message }],
    };
  }

  return bindFounderAuthorization({
    store: input.store,
    expectedTip: input.expectedTip,
    commentBody: verified.value.body,
    observedFounderActorId: verified.value.actorId,
    expectedFounderActorId: input.config.founderActorId,
    commentAction: verified.value.commentAction,
    issueNumber: verified.value.issueNumber,
    commentId: verified.value.commentId,
    createdAt: verified.value.createdAt,
  });
}
