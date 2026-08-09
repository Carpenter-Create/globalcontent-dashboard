import { z } from "zod";

import type { AgenticGitHubConfig } from "./github-config";
import {
  githubPaginate,
  type GitHubHttpResult,
  type GitHubTransport,
} from "./github-http";

const gitSha = z.string().regex(/^[0-9a-f]{40}$/);

const repoSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  owner: z.object({
    login: z.string().min(1),
    id: z.number().int().positive(),
  }),
});

const refSchema = z.object({
  ref: z.string().min(1),
  object: z.object({
    sha: gitSha,
    type: z.string().min(1),
  }),
});

const issueCommentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  user: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
  }),
  html_url: z.string().min(1).optional(),
  /** Present on REST issue-comment payloads; used to bind comment → issue. */
  issue_url: z.string().min(1).optional(),
});

const pullSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  head: z.object({
    sha: gitSha,
    ref: z.string().min(1),
  }),
  base: z.object({
    sha: gitSha,
    ref: z.string().min(1),
  }),
});

const checkRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  head_sha: gitSha,
  status: z.string().min(1),
  conclusion: z.string().nullable(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  app: z
    .object({
      id: z.number().int().positive().optional(),
      slug: z.string().optional(),
      name: z.string().optional(),
    })
    .nullable()
    .optional(),
});

const reviewSchema = z.object({
  id: z.number().int().positive(),
  state: z.string().min(1),
  commit_id: gitSha.nullable(),
  submitted_at: z.string().nullable(),
  user: z
    .object({
      id: z.number().int().positive(),
      login: z.string().min(1),
    })
    .nullable(),
});

const gitTreeEntrySchema = z.object({
  path: z.string().min(1),
  mode: z.string().min(1),
  type: z.enum(["blob", "tree", "commit"]),
  sha: gitSha,
  size: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
});

const gitTreeSchema = z.object({
  sha: gitSha,
  truncated: z.boolean(),
  tree: z.array(gitTreeEntrySchema),
});

const gitCommitSchema = z.object({
  sha: gitSha,
  tree: z.object({ sha: gitSha }),
  parents: z.array(z.object({ sha: gitSha })),
});

const gitBlobSchema = z.object({
  sha: gitSha,
  content: z.string(),
  encoding: z.enum(["base64", "utf-8"]),
});

export type GitHubRepoIdentity = z.infer<typeof repoSchema>;
export type GitHubIssueComment = z.infer<typeof issueCommentSchema>;
export type GitHubPullRequest = z.infer<typeof pullSchema>;
export type GitHubCheckRun = z.infer<typeof checkRunSchema>;
export type GitHubReview = z.infer<typeof reviewSchema>;
export type GitTreeEntry = z.infer<typeof gitTreeEntrySchema>;

function parse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): GitHubHttpResult<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    return {
      ok: false,
      code: "invalid_json",
      message: `${label} failed schema validation: ${r.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  return { ok: true, data: r.data, status: 200 };
}

export class GitHubRestClient {
  constructor(
    private readonly config: AgenticGitHubConfig,
    private readonly transport: GitHubTransport,
  ) {}

  private repoPath(suffix: string): string {
    return `/repos/${this.config.owner}/${this.config.repo}${suffix}`;
  }

  async getRepository(): Promise<GitHubHttpResult<GitHubRepoIdentity>> {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(""),
    });
    if (!res.ok) return res;
    return parse(repoSchema, res.data, "repository");
  }

  async getBranchTip(branch: string): Promise<GitHubHttpResult<string>> {
    const encoded = encodeURIComponent(branch);
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/git/ref/heads/${encoded}`),
    });
    if (!res.ok) return res;
    const parsed = parse(refSchema, res.data, "git ref");
    if (!parsed.ok) return parsed;
    return { ok: true, data: parsed.data.object.sha, status: 200 };
  }

  async getIssueComment(
    commentId: number,
  ): Promise<GitHubHttpResult<GitHubIssueComment>> {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/issues/comments/${commentId}`),
    });
    if (!res.ok) return res;
    return parse(issueCommentSchema, res.data, "issue comment");
  }

  async getPullRequest(
    prNumber: number,
  ): Promise<GitHubHttpResult<GitHubPullRequest>> {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/pulls/${prNumber}`),
    });
    if (!res.ok) return res;
    return parse(pullSchema, res.data, "pull request");
  }

  async listCheckRunsForSha(
    sha: string,
  ): Promise<GitHubHttpResult<GitHubCheckRun[]>> {
    const path = this.repoPath(
      `/commits/${sha}/check-runs?per_page=100`,
    );
    const pages = await githubPaginate(
      this.transport,
      path,
      (page) => {
        if (
          typeof page === "object" &&
          page !== null &&
          "check_runs" in page &&
          Array.isArray((page as { check_runs: unknown }).check_runs)
        ) {
          return (page as { check_runs: unknown[] }).check_runs;
        }
        return [];
      },
    );
    if (!pages.ok) return pages;
    const out: GitHubCheckRun[] = [];
    for (const item of pages.data) {
      const parsed = parse(checkRunSchema, item, "check run");
      if (!parsed.ok) return parsed;
      out.push(parsed.data);
    }
    return { ok: true, data: out, status: 200 };
  }

  async listPullReviews(
    prNumber: number,
  ): Promise<GitHubHttpResult<GitHubReview[]>> {
    const path = this.repoPath(`/pulls/${prNumber}/reviews?per_page=100`);
    const pages = await githubPaginate(this.transport, path, (page) =>
      Array.isArray(page) ? page : [],
    );
    if (!pages.ok) return pages;
    const out: GitHubReview[] = [];
    for (const item of pages.data) {
      const parsed = parse(reviewSchema, item, "pull review");
      if (!parsed.ok) return parsed;
      out.push(parsed.data);
    }
    return { ok: true, data: out, status: 200 };
  }

  async getCommit(sha: string): Promise<
    GitHubHttpResult<{ sha: string; treeSha: string; parentShas: string[] }>
  > {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/git/commits/${sha}`),
    });
    if (!res.ok) return res;
    const parsed = parse(gitCommitSchema, res.data, "git commit");
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      status: 200,
      data: {
        sha: parsed.data.sha,
        treeSha: parsed.data.tree.sha,
        parentShas: parsed.data.parents.map((p) => p.sha),
      },
    };
  }

  async getTreeRecursive(
    treeSha: string,
  ): Promise<GitHubHttpResult<{ sha: string; truncated: boolean; tree: GitTreeEntry[] }>> {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/git/trees/${treeSha}?recursive=1`),
    });
    if (!res.ok) return res;
    const parsed = parse(gitTreeSchema, res.data, "git tree");
    if (!parsed.ok) return parsed;
    if (parsed.data.truncated) {
      return {
        ok: false,
        code: "http_error",
        message: "git tree response truncated; refuse partial control state",
      };
    }
    return { ok: true, data: parsed.data, status: 200 };
  }

  async getBlobUtf8(blobSha: string): Promise<GitHubHttpResult<string>> {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath(`/git/blobs/${blobSha}`),
    });
    if (!res.ok) return res;
    const parsed = parse(gitBlobSchema, res.data, "git blob");
    if (!parsed.ok) return parsed;
    if (parsed.data.encoding === "base64") {
      return {
        ok: true,
        status: 200,
        data: Buffer.from(parsed.data.content.replace(/\n/g, ""), "base64").toString(
          "utf8",
        ),
      };
    }
    return { ok: true, status: 200, data: parsed.data.content };
  }

  async createBlob(contentUtf8: string): Promise<GitHubHttpResult<string>> {
    const res = await this.transport.request<unknown>({
      method: "POST",
      path: this.repoPath("/git/blobs"),
      body: {
        content: Buffer.from(contentUtf8, "utf8").toString("base64"),
        encoding: "base64",
      },
    });
    if (!res.ok) return res;
    const sha = z.object({ sha: gitSha }).safeParse(res.data);
    if (!sha.success) {
      return {
        ok: false,
        code: "invalid_json",
        message: "create blob response missing sha",
      };
    }
    return { ok: true, data: sha.data.sha, status: res.status };
  }

  async createTree(
    entries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }>,
    baseTreeSha?: string,
  ): Promise<GitHubHttpResult<string>> {
    const res = await this.transport.request<unknown>({
      method: "POST",
      path: this.repoPath("/git/trees"),
      body: {
        ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
        tree: entries,
      },
    });
    if (!res.ok) return res;
    const sha = z.object({ sha: gitSha }).safeParse(res.data);
    if (!sha.success) {
      return {
        ok: false,
        code: "invalid_json",
        message: "create tree response missing sha",
      };
    }
    return { ok: true, data: sha.data.sha, status: res.status };
  }

  async createCommit(input: {
    message: string;
    treeSha: string;
    parentShas: string[];
  }): Promise<GitHubHttpResult<string>> {
    const res = await this.transport.request<unknown>({
      method: "POST",
      path: this.repoPath("/git/commits"),
      body: {
        message: input.message,
        tree: input.treeSha,
        parents: input.parentShas,
      },
    });
    if (!res.ok) return res;
    const sha = z.object({ sha: gitSha }).safeParse(res.data);
    if (!sha.success) {
      return {
        ok: false,
        code: "invalid_json",
        message: "create commit response missing sha",
      };
    }
    return { ok: true, data: sha.data.sha, status: res.status };
  }

  async createRef(ref: string, sha: string): Promise<GitHubHttpResult<string>> {
    const res = await this.transport.request<unknown>({
      method: "POST",
      path: this.repoPath("/git/refs"),
      body: { ref, sha },
    });
    if (!res.ok) return res;
    return { ok: true, data: sha, status: res.status };
  }

  /**
   * Non-force ref update. GitHub rejects non-fast-forward when force is false.
   */
  async updateRef(
    branch: string,
    sha: string,
    expectedTip: string,
  ): Promise<GitHubHttpResult<string>> {
    // Re-check tip immediately before update (CAS observe).
    const tip = await this.getBranchTip(branch);
    if (!tip.ok) return tip;
    if (tip.data !== expectedTip) {
      return {
        ok: false,
        code: "http_error",
        message: `stale_tip: expected ${expectedTip}, observed ${tip.data}`,
        status: 409,
      };
    }
    const encoded = encodeURIComponent(branch);
    const res = await this.transport.request<unknown>({
      method: "PATCH",
      path: this.repoPath(`/git/refs/heads/${encoded}`),
      body: { sha, force: false },
    });
    if (!res.ok) {
      if (res.status === 422) {
        return {
          ok: false,
          code: "http_error",
          message: `stale_tip_or_rejected: ${res.message}`,
          status: 422,
        };
      }
      return res;
    }
    return { ok: true, data: sha, status: res.status };
  }

  async listRepoRulesets(): Promise<
    GitHubHttpResult<Array<{ id: number; name: string; enforcement: string }>>
  > {
    const res = await this.transport.request<unknown>({
      method: "GET",
      path: this.repoPath("/rulesets"),
    });
    if (!res.ok) {
      // Many tokens cannot read rulesets — surface UNKNOWN upstream.
      return res;
    }
    if (!Array.isArray(res.data)) {
      return {
        ok: false,
        code: "invalid_json",
        message: "rulesets response is not an array",
      };
    }
    const out: Array<{ id: number; name: string; enforcement: string }> = [];
    for (const item of res.data) {
      const parsed = z
        .object({
          id: z.number().int().positive(),
          name: z.string().min(1),
          enforcement: z.string().min(1),
        })
        .safeParse(item);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_json",
          message: "ruleset entry failed schema validation",
        };
      }
      out.push(parsed.data);
    }
    return { ok: true, data: out, status: 200 };
  }
}
