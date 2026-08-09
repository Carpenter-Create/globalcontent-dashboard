import type { AgenticGitHubConfig } from "./github-config";
import { repoFullName } from "./github-config";
import type { GitHubRestClient } from "./github-rest";

export type PreflightAnswer = "YES" | "NO" | "UNKNOWN";

export type ProtectionPreflightReport = {
  repository: string;
  controlBranch: string;
  branchExists: PreflightAnswer;
  tip: string | null;
  forcePushesBlocked: PreflightAnswer;
  deletionBlocked: PreflightAnswer;
  expectedWritersDocumented: PreflightAnswer;
  implementerReviewerCannotWrite: PreflightAnswer;
  founderRecoveryAuthority: PreflightAnswer;
  noUnintendedBypass: PreflightAnswer;
  rulesetsReadable: PreflightAnswer;
  rulesetNames: string[];
  notes: string[];
  /** True only when every critical protection check is YES. */
  writesSafeToClaim: boolean;
};

/**
 * READ/VERIFY protection preflight. Never mutates rulesets.
 * Reports UNKNOWN when APIs are inaccessible rather than assuming safe.
 */
export async function runProtectionPreflight(
  client: GitHubRestClient,
  config: AgenticGitHubConfig,
): Promise<ProtectionPreflightReport> {
  const notes: string[] = [];
  const report: ProtectionPreflightReport = {
    repository: repoFullName(config),
    controlBranch: config.controlBranch,
    branchExists: "UNKNOWN",
    tip: null,
    forcePushesBlocked: "UNKNOWN",
    deletionBlocked: "UNKNOWN",
    expectedWritersDocumented: "UNKNOWN",
    implementerReviewerCannotWrite: "UNKNOWN",
    founderRecoveryAuthority: "UNKNOWN",
    noUnintendedBypass: "UNKNOWN",
    rulesetsReadable: "UNKNOWN",
    rulesetNames: [],
    notes,
    writesSafeToClaim: false,
  };

  const repo = await client.getRepository();
  if (!repo.ok) {
    notes.push(`repository read failed: ${repo.message}`);
    return report;
  }
  if (repo.data.full_name !== report.repository) {
    notes.push(
      `repository mismatch: expected ${report.repository}, got ${repo.data.full_name}`,
    );
    report.branchExists = "NO";
    return report;
  }

  const tip = await client.getBranchTip(config.controlBranch);
  if (!tip.ok) {
    if (tip.code === "not_found") {
      report.branchExists = "NO";
      notes.push(`${config.controlBranch} does not exist`);
    } else {
      notes.push(`branch tip read failed: ${tip.message}`);
    }
    return report;
  }
  report.branchExists = "YES";
  report.tip = tip.data;

  const rulesets = await client.listRepoRulesets();
  if (!rulesets.ok) {
    report.rulesetsReadable = "UNKNOWN";
    notes.push(
      `rulesets not readable with current credential (${rulesets.status ?? rulesets.code}): ${rulesets.message}`,
    );
    notes.push(
      "Cannot verify force-push/deletion/writer restrictions — do not claim live writes safe",
    );
  } else {
    report.rulesetsReadable = "YES";
    report.rulesetNames = rulesets.data.map((r) => r.name);
    if (rulesets.data.length === 0) {
      notes.push("no repository rulesets returned — protection may be absent");
      report.forcePushesBlocked = "UNKNOWN";
      report.deletionBlocked = "UNKNOWN";
      report.expectedWritersDocumented = "UNKNOWN";
      report.implementerReviewerCannotWrite = "UNKNOWN";
      report.founderRecoveryAuthority = "UNKNOWN";
      report.noUnintendedBypass = "UNKNOWN";
    } else {
      notes.push(
        `rulesets visible: ${report.rulesetNames.join(", ")}. Detailed per-branch rule inspection requires additional API access; treat force-push/deletion/writer checks as UNKNOWN until founder confirms ruleset contents.`,
      );
      // Fine-grained visibility of branch rules needs ruleset detail endpoints;
      // without them we refuse to claim YES.
      report.forcePushesBlocked = "UNKNOWN";
      report.deletionBlocked = "UNKNOWN";
      report.expectedWritersDocumented = "UNKNOWN";
      report.implementerReviewerCannotWrite = "UNKNOWN";
      report.founderRecoveryAuthority = "UNKNOWN";
      report.noUnintendedBypass = "UNKNOWN";
    }
  }

  report.writesSafeToClaim =
    report.branchExists === "YES" &&
    report.forcePushesBlocked === "YES" &&
    report.deletionBlocked === "YES" &&
    report.implementerReviewerCannotWrite === "YES" &&
    report.noUnintendedBypass === "YES";

  if (!report.writesSafeToClaim) {
    notes.push("writesSafeToClaim=false — founder must confirm protections before live write activation");
  }

  return report;
}
