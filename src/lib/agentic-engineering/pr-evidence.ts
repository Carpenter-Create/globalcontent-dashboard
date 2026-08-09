import type { ObservedCheckResult } from "./closure-readiness";
import type { GitHubRestClient } from "./github-rest";

export type NormalizedCheckEvidence = {
  checkRunId: number;
  name: string;
  sha: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  appId: number | null;
  appSlug: string | null;
  appName: string | null;
};

export type NormalizedReviewEvidence = {
  reviewId: number;
  reviewerId: number | null;
  reviewerLogin: string | null;
  state: string;
  commitId: string | null;
  submittedAt: string | null;
  /** True when review commit_id equals current PR head SHA. */
  freshAgainstHead: boolean;
};

export type PrEvidenceBundle = {
  prNumber: number;
  open: boolean;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  checks: NormalizedCheckEvidence[];
  reviews: NormalizedReviewEvidence[];
  /** Mapped into Phase A ObservedCheckResult shape. */
  observedChecks: ObservedCheckResult[];
  /** Duplicate display-name groups (spoof-like surface). */
  duplicateCheckNames: string[];
};

export type PrEvidenceResult =
  | { ok: true; value: PrEvidenceBundle }
  | { ok: false; code: string; message: string };

function mapConclusion(
  status: string,
  conclusion: string | null,
): ObservedCheckResult["conclusion"] {
  if (status === "queued") return "queued";
  if (status === "in_progress") return "in_progress";
  if (conclusion === "success") return "success";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
    return "failure";
  }
  if (conclusion === "neutral" || conclusion === "skipped") return "neutral";
  if (!conclusion) return "pending";
  return "pending";
}

/**
 * Read-only PR evidence ingestion for Phase A closure fields.
 * Does not transition closure or merge.
 */
export async function ingestPrEvidence(
  client: GitHubRestClient,
  prNumber: number,
): Promise<PrEvidenceResult> {
  const pr = await client.getPullRequest(prNumber);
  if (!pr.ok) {
    return { ok: false, code: pr.code, message: pr.message };
  }

  const headSha = pr.data.head.sha;
  const checksRes = await client.listCheckRunsForSha(headSha);
  if (!checksRes.ok) {
    return { ok: false, code: checksRes.code, message: checksRes.message };
  }
  const reviewsRes = await client.listPullReviews(prNumber);
  if (!reviewsRes.ok) {
    return { ok: false, code: reviewsRes.code, message: reviewsRes.message };
  }

  const checks: NormalizedCheckEvidence[] = checksRes.data.map((c) => ({
    checkRunId: c.id,
    name: c.name,
    sha: c.head_sha,
    status: c.status,
    conclusion: c.conclusion,
    startedAt: c.started_at ?? null,
    completedAt: c.completed_at ?? null,
    appId: c.app?.id ?? null,
    appSlug: c.app?.slug ?? null,
    appName: c.app?.name ?? null,
  }));

  const nameCounts = new Map<string, number>();
  for (const c of checks) {
    nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
  }
  const duplicateCheckNames = [...nameCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([name]) => name);

  const reviews: NormalizedReviewEvidence[] = reviewsRes.data.map((r) => ({
    reviewId: r.id,
    reviewerId: r.user?.id ?? null,
    reviewerLogin: r.user?.login ?? null,
    state: r.state,
    commitId: r.commit_id,
    submittedAt: r.submitted_at,
    freshAgainstHead: r.commit_id === headSha,
  }));

  const observedChecks: ObservedCheckResult[] = checks.map((c) => ({
    name: c.name,
    sha: c.sha,
    conclusion: mapConclusion(c.status, c.conclusion),
    checkRunId: String(c.checkRunId),
  }));

  return {
    ok: true,
    value: {
      prNumber,
      open: pr.data.state === "open",
      headSha,
      baseBranch: pr.data.base.ref,
      baseSha: pr.data.base.sha,
      checks,
      reviews,
      observedChecks,
      duplicateCheckNames,
    },
  };
}
