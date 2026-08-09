import { openGitHubControlStore } from "./control-github-store";
import { readControlBranchAtTip } from "./control-github-read";
import type {
  CheckRunEvidence,
  ConstrainedControlTransaction,
  GitHubControlPlaneClient,
  IssueCommentMetadata,
  PullRequestHead,
  ReviewMetadata,
} from "./github-boundary";
import type { AgenticGitHubConfig } from "./github-config";
import type { GitHubRestClient } from "./github-rest";
import type { ControlSnapshot } from "./control-store";
import { ingestPrEvidence } from "./pr-evidence";

/**
 * Phase C live GitHub boundary — reads + constrained control-plane store access.
 * proposeConstrainedTransaction remains refuse-by-default; use supervised CLI /
 * ledger APIs with openGitHubControlStore instead of raw transactions.
 */
export class LiveGitHubBoundaryClient implements GitHubControlPlaneClient {
  constructor(
    private readonly client: GitHubRestClient,
    private readonly config: AgenticGitHubConfig,
  ) {}

  controlStore() {
    return openGitHubControlStore(this.client, this.config);
  }

  async readBranchTip(branch: string): Promise<string> {
    const tip = await this.client.getBranchTip(branch);
    if (!tip.ok) throw new Error(tip.message);
    return tip.data;
  }

  async readControlObjects(tip: string): Promise<ControlSnapshot> {
    const read = await readControlBranchAtTip(this.client, tip);
    if (!read.ok) throw new Error(read.message);
    if (read.value.tip !== tip) {
      throw new Error(`tip mismatch: requested ${tip}, observed ${read.value.tip}`);
    }
    return { tip: read.value.tip, objects: read.value.objects };
  }

  async proposeConstrainedTransaction(
    branch: string,
    _expectedTip: string,
    transaction: ConstrainedControlTransaction,
  ): Promise<{ ok: true; tip: string } | { ok: false; code: string; message: string }> {
    if (branch !== this.config.controlBranch) {
      return {
        ok: false,
        code: "wrong_branch",
        message: `writes only permitted on ${this.config.controlBranch}`,
      };
    }
    return {
      ok: false,
      code: "use_supervised_cli",
      message: `Phase C: use supervised ae:control / ledger APIs for ${transaction.kind}; raw proposeConstrainedTransaction is not a write escape hatch`,
    };
  }

  async readIssueComment(
    issueNumber: number,
    commentId: number,
  ): Promise<IssueCommentMetadata | null> {
    const comment = await this.client.getIssueComment(commentId);
    if (!comment.ok) {
      if (comment.code === "not_found") return null;
      throw new Error(comment.message);
    }
    const issueFromUrl =
      comment.data.issue_url?.match(/\/issues\/(\d+)/)?.[1] ??
      comment.data.html_url?.match(/\/issues\/(\d+)/)?.[1];
    if (issueFromUrl && Number(issueFromUrl) !== issueNumber) {
      throw new Error(
        `comment ${commentId} belongs to issue ${issueFromUrl}, not ${issueNumber}`,
      );
    }
    const action =
      comment.data.created_at === comment.data.updated_at ? "created" : "edited";
    return {
      issueNumber,
      commentId: comment.data.id,
      actorId: comment.data.user.id,
      action,
      body: comment.data.body,
      createdAt: comment.data.created_at,
    };
  }

  async readPullRequestHead(prNumber: number): Promise<PullRequestHead | null> {
    const pr = await this.client.getPullRequest(prNumber);
    if (!pr.ok) {
      if (pr.code === "not_found") return null;
      throw new Error(pr.message);
    }
    return {
      number: pr.data.number,
      headSha: pr.data.head.sha,
      open: pr.data.state === "open",
    };
  }

  async readCheckRuns(sha: string): Promise<CheckRunEvidence[]> {
    const runs = await this.client.listCheckRunsForSha(sha);
    if (!runs.ok) throw new Error(runs.message);
    return runs.data.map((c) => ({
      name: c.name,
      sha: c.head_sha,
      conclusion: c.conclusion ?? c.status,
      checkRunId: String(c.id),
    }));
  }

  async readReviewMetadata(prNumber: number): Promise<ReviewMetadata | null> {
    const evidence = await ingestPrEvidence(this.client, prNumber);
    if (!evidence.ok) throw new Error(evidence.message);
    const freshApproved = evidence.value.reviews
      .filter((r) => r.freshAgainstHead && r.state.toUpperCase() === "APPROVED")
      .at(-1);
    if (!freshApproved) return null;
    return {
      prNumber,
      reviewedSha: freshApproved.commitId ?? evidence.value.headSha,
      state: freshApproved.state,
      reviewerSessionOrRunId: freshApproved.reviewerLogin,
    };
  }
}
