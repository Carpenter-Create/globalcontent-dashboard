import type { ControlSnapshot, ControlStore, ControlTip } from "./control-store";

/**
 * GitHub control-plane boundary.
 * Phase B: LocalGitHubBoundaryAdapter / UnimplementedGitHubBoundaryClient.
 * Phase C: LiveGitHubBoundaryClient (reads + supervised control store; no raw CAS).
 */

export type GitHubCommentAction = "created" | "edited" | "deleted";

export type IssueCommentMetadata = {
  issueNumber: number;
  commentId: number;
  actorId: number;
  action: GitHubCommentAction;
  body: string;
  createdAt: string;
};

export type PullRequestHead = {
  number: number;
  headSha: string;
  open: boolean;
};

export type CheckRunEvidence = {
  name: string;
  sha: string;
  conclusion: string;
  checkRunId: string;
};

export type ReviewMetadata = {
  prNumber: number;
  reviewedSha: string;
  state: string;
  reviewerSessionOrRunId: string | null;
};

/** Constrained future write kinds — never raw object-set replacement. */
export type ConstrainedControlTransactionKind =
  | "stage_contract"
  | "freeze_contract"
  | "append_operational_event"
  | "bind_founder_authorization"
  | "record_founder_event"
  | "add_derived_closure";

export type ConstrainedControlTransaction = {
  kind: ConstrainedControlTransactionKind;
  /** Opaque dry-run / future payload — not executed in Phase B remote client. */
  description: string;
};

/**
 * Conceptual operations for a future privileged orchestrator.
 * Real GitHub mutation methods must remain unimplemented until founder-approved activation.
 */
export interface GitHubControlPlaneClient {
  readBranchTip(branch: string): Promise<string>;
  readControlObjects(tip: string): Promise<ControlSnapshot>;
  /**
   * Future constrained transaction entrypoint.
   * Phase B always refuses — never performs unrestricted CAS.
   */
  proposeConstrainedTransaction(
    branch: string,
    expectedTip: string,
    transaction: ConstrainedControlTransaction,
  ): Promise<{ ok: true; tip: string } | { ok: false; code: string; message: string }>;
  readIssueComment(
    issueNumber: number,
    commentId: number,
  ): Promise<IssueCommentMetadata | null>;
  readPullRequestHead(prNumber: number): Promise<PullRequestHead | null>;
  readCheckRuns(sha: string): Promise<CheckRunEvidence[]>;
  readReviewMetadata(prNumber: number): Promise<ReviewMetadata | null>;
}

/** Local dry-run adapter backed by a ControlStore. GitHub mutations are not available. */
export class LocalGitHubBoundaryAdapter implements GitHubControlPlaneClient {
  constructor(
    private readonly store: ControlStore,
    private readonly controlBranch = "ae/control",
  ) {}

  async readBranchTip(branch: string): Promise<string> {
    if (branch !== this.controlBranch) {
      throw new Error(
        `Phase B dry-run: only local branch alias ${this.controlBranch} is supported`,
      );
    }
    return this.store.getTip();
  }

  async readControlObjects(tip: string): Promise<ControlSnapshot> {
    const snap = await this.store.getSnapshot();
    if (snap.tip !== tip) {
      throw new Error(`tip mismatch: requested ${tip}, observed ${snap.tip}`);
    }
    return snap;
  }

  async proposeConstrainedTransaction(
    _branch: string,
    _expectedTip: string,
    transaction: ConstrainedControlTransaction,
  ): Promise<{ ok: true; tip: string } | { ok: false; code: string; message: string }> {
    return {
      ok: false,
      code: "not_activated",
      message: `Phase B dry-run: GitHub constrained transaction ${transaction.kind} is not activated (no credentials, no network writes, no raw CAS)`,
    };
  }

  async readIssueComment(): Promise<IssueCommentMetadata | null> {
    throw new Error(
      "Phase B dry-run: GitHub Issue comment reads are not activated — supply dry-run inputs",
    );
  }

  async readPullRequestHead(): Promise<PullRequestHead | null> {
    throw new Error(
      "Phase B dry-run: GitHub PR reads are not activated — supply dry-run inputs",
    );
  }

  async readCheckRuns(): Promise<CheckRunEvidence[]> {
    throw new Error(
      "Phase B dry-run: GitHub check-run reads are not activated — supply dry-run inputs",
    );
  }

  async readReviewMetadata(): Promise<ReviewMetadata | null> {
    throw new Error(
      "Phase B dry-run: GitHub review reads are not activated — supply dry-run inputs",
    );
  }
}

/** Explicit not-activated client — all methods refuse remote operations. */
export class UnimplementedGitHubBoundaryClient implements GitHubControlPlaneClient {
  private refuse(op: string): Error {
    return new Error(
      `Phase B dry-run: GitHub ${op} is not activated (no credentials, no network writes)`,
    );
  }

  readBranchTip(): Promise<string> {
    return Promise.reject(this.refuse("readBranchTip"));
  }
  readControlObjects(): Promise<ControlSnapshot> {
    return Promise.reject(this.refuse("readControlObjects"));
  }
  proposeConstrainedTransaction(): Promise<
    { ok: true; tip: string } | { ok: false; code: string; message: string }
  > {
    return Promise.reject(this.refuse("proposeConstrainedTransaction"));
  }
  readIssueComment(): Promise<IssueCommentMetadata | null> {
    return Promise.reject(this.refuse("readIssueComment"));
  }
  readPullRequestHead(): Promise<PullRequestHead | null> {
    return Promise.reject(this.refuse("readPullRequestHead"));
  }
  readCheckRuns(): Promise<CheckRunEvidence[]> {
    return Promise.reject(this.refuse("readCheckRuns"));
  }
  readReviewMetadata(): Promise<ReviewMetadata | null> {
    return Promise.reject(this.refuse("readReviewMetadata"));
  }
}

export type { ControlTip };
