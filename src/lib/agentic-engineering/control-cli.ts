import { readFile } from "node:fs/promises";

import { stageContract } from "./control-ledger";
import { bootstrapControlBranch } from "./control-bootstrap";
import { openGitHubControlStore } from "./control-github-store";
import { readControlBranch } from "./control-github-read";
import { compareAndSwapControlBranch } from "./control-github-write";
import {
  loadAgenticGitHubConfig,
  type AgenticGitHubConfig,
} from "./github-config";
import {
  loadGitHubCredentialFromEnv,
  redactSecrets,
} from "./github-credentials";
import { createFetchGitHubTransport } from "./github-http";
import { GitHubRestClient } from "./github-rest";
import {
  liveAuthorizeAndFreeze,
  verifyLiveFounderAuthorization,
} from "./live-founder-authorization";
import { ingestPrEvidence } from "./pr-evidence";
import { runProtectionPreflight } from "./protection-preflight";
import type { GitHubTransport } from "./github-http";
import { FakeGitHubTransport } from "./fake-github";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ParsedArgs = {
  command: string | null;
  json: boolean;
  apply: boolean;
  flags: Record<string, string>;
  positionals: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  let json = false;
  let apply = false;
  let command: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--apply") {
      apply = true;
      continue;
    }
    if (a === "--dry-run") {
      apply = false;
      flags["dry-run"] = "true";
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = val;
      continue;
    }
    if (!command) command = a;
    else positionals.push(a);
  }
  return { command, json, apply, flags, positionals };
}

function emit(jsonMode: boolean, ok: boolean, data: unknown): CliResult {
  const safe = JSON.parse(redactSecrets(JSON.stringify(data))) as unknown;
  if (jsonMode) {
    return {
      exitCode: ok ? 0 : 1,
      stdout: `${JSON.stringify({ ok, data: safe }, null, 2)}\n`,
      stderr: "",
    };
  }
  if (ok) {
    return {
      exitCode: 0,
      stdout: `${typeof safe === "string" ? safe : JSON.stringify(safe, null, 2)}\n`,
      stderr: "",
    };
  }
  const msg =
    typeof safe === "object" &&
    safe !== null &&
    "message" in safe &&
    typeof (safe as { message: unknown }).message === "string"
      ? (safe as { message: string }).message
      : JSON.stringify(safe);
  return { exitCode: 1, stdout: "", stderr: `${redactSecrets(msg)}\n` };
}

function helpText(): string {
  return `Agentic Engineering Phase C — supervised GitHub control CLI

Usage:
  pnpm ae:control -- help
  pnpm ae:control -- github-read
  pnpm ae:control -- verify-founder-authorization --issue N --comment ID \\
      --task AE-0001 --version 1 --digest sha256:... --base-sha <40hex>
  pnpm ae:control -- control-status
  pnpm ae:control -- control-bootstrap [--dry-run|--apply]
  pnpm ae:control -- control-append --task AE-0001 --file contract.yaml [--apply]
  pnpm ae:control -- control-authorize --issue N --comment ID --task AE-0001 \\
      --version 1 --digest sha256:... --base-sha <40hex> [--apply]
  pnpm ae:control -- pr-evidence --pr N
  pnpm ae:control -- protection-preflight

Environment:
  AE_GITHUB_TOKEN   bearer (App installation token preferred)
  AE_GITHUB_OWNER   repository owner
  AE_GITHUB_REPO    repository name
  AE_CONTROL_BRANCH default ae/control
  AE_FOUNDER_GITHUB_ACTOR_ID  default 40549435

Mutating commands default to dry-run. Pass --apply for live ae/control writes.
Secrets are never printed.
`;
}

function loadConfig(flags: Record<string, string>) {
  return loadAgenticGitHubConfig({
    owner: flags.owner,
    repo: flags.repo,
    controlBranch: flags.branch,
  });
}

function createClient(
  config: AgenticGitHubConfig,
  transport?: GitHubTransport,
): { ok: true; client: GitHubRestClient } | { ok: false; message: string } {
  if (transport) {
    return { ok: true, client: new GitHubRestClient(config, transport) };
  }
  const cred = loadGitHubCredentialFromEnv("read");
  if (!cred.ok) {
    return { ok: false, message: cred.message };
  }
  const t = createFetchGitHubTransport(config, cred.credential);
  return { ok: true, client: new GitHubRestClient(config, t) };
}

export type RunControlCliOptions = {
  /** Inject fake transport for tests — never used by the real script. */
  transport?: GitHubTransport;
};

/**
 * Supervised Phase C CLI. Mutating ops require --apply.
 */
export async function runAeControlCli(
  argv: string[],
  options: RunControlCliOptions = {},
): Promise<CliResult> {
  const args = parseArgs(argv);
  const command = args.command ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: helpText(), stderr: "" };
  }

  const cfg = loadConfig(args.flags);
  if (!cfg.ok) {
    return emit(args.json, false, { message: cfg.message, code: cfg.code });
  }

  const clientRes = createClient(cfg.config, options.transport);
  if (!clientRes.ok) {
    return emit(args.json, false, { message: clientRes.message });
  }
  const client = clientRes.client;

  try {
    switch (command) {
      case "github-read": {
        const repo = await client.getRepository();
        if (!repo.ok) {
          return emit(args.json, false, {
            message: repo.message,
            code: repo.code,
          });
        }
        const mainTip = await client.getBranchTip(repo.data.default_branch);
        return emit(args.json, true, {
          repository: repo.data.full_name,
          defaultBranch: repo.data.default_branch,
          defaultBranchTip: mainTip.ok ? mainTip.data : null,
        });
      }

      case "control-status": {
        const read = await readControlBranch(client, cfg.config);
        if (!read.ok) {
          return emit(args.json, false, {
            message: read.message,
            code: read.code,
          });
        }
        return emit(args.json, true, {
          repository: `${cfg.config.owner}/${cfg.config.repo}`,
          controlBranch: cfg.config.controlBranch,
          tip: read.value.tip,
          treeSha: read.value.treeSha,
          objectCount: read.value.objects.size,
          metadataPaths: [...read.value.metadata.keys()],
          paths: [...read.value.objects.keys()].sort(),
        });
      }

      case "control-bootstrap": {
        const result = await bootstrapControlBranch({
          client,
          config: cfg.config,
          apply: args.apply,
        });
        if (!result.ok) {
          return emit(args.json, false, {
            message: result.message,
            code: result.code,
          });
        }
        return emit(args.json, true, result);
      }

      case "protection-preflight": {
        const report = await runProtectionPreflight(client, cfg.config);
        // Preflight always reports; UNKNOWN protections are data, not CLI crash.
        return emit(args.json, true, report);
      }

      case "verify-founder-authorization": {
        const issue = Number(args.flags.issue);
        const comment = Number(args.flags.comment);
        const version = Number(args.flags.version);
        if (!issue || !comment || !args.flags.task || !version || !args.flags.digest || !args.flags["base-sha"]) {
          return emit(args.json, false, {
            message:
              "require --issue --comment --task --version --digest --base-sha",
          });
        }
        const verified = await verifyLiveFounderAuthorization(client, cfg.config, {
          issueNumber: issue,
          commentId: comment,
          expectedTaskId: args.flags.task,
          expectedContractVersion: version,
          expectedContractDigest: args.flags.digest,
          expectedBaseSha: args.flags["base-sha"],
        });
        if (!verified.ok) {
          return emit(args.json, false, {
            message: verified.message,
            code: verified.code,
          });
        }
        return emit(args.json, true, verified.value);
      }

      case "control-authorize": {
        const issue = Number(args.flags.issue);
        const comment = Number(args.flags.comment);
        const version = Number(args.flags.version);
        if (!issue || !comment || !args.flags.task || !version || !args.flags.digest || !args.flags["base-sha"]) {
          return emit(args.json, false, {
            message:
              "require --issue --comment --task --version --digest --base-sha",
          });
        }
        const tip = await client.getBranchTip(cfg.config.controlBranch);
        if (!tip.ok) {
          return emit(args.json, false, { message: tip.message, code: tip.code });
        }
        const preview = {
          repository: `${cfg.config.owner}/${cfg.config.repo}`,
          controlBranch: cfg.config.controlBranch,
          expectedTip: tip.data,
          apply: args.apply,
        };
        if (!args.apply) {
          const verified = await verifyLiveFounderAuthorization(
            client,
            cfg.config,
            {
              issueNumber: issue,
              commentId: comment,
              expectedTaskId: args.flags.task,
              expectedContractVersion: version,
              expectedContractDigest: args.flags.digest,
              expectedBaseSha: args.flags["base-sha"],
            },
          );
          return emit(args.json, verified.ok, {
            dryRun: true,
            preview,
            verification: verified.ok
              ? { ok: true, commentId: verified.value.commentId }
              : verified,
          });
        }
        const store = openGitHubControlStore(client, cfg.config);
        const result = await liveAuthorizeAndFreeze({
          client,
          config: cfg.config,
          store,
          expectedTip: tip.data,
          expectations: {
            issueNumber: issue,
            commentId: comment,
            expectedTaskId: args.flags.task,
            expectedContractVersion: version,
            expectedContractDigest: args.flags.digest,
            expectedBaseSha: args.flags["base-sha"],
          },
        });
        if (!result.ok) {
          return emit(args.json, false, {
            message: result.issues.map((i) => i.message).join("; "),
            issues: result.issues,
            preview,
          });
        }
        return emit(args.json, true, { preview, result: result.value });
      }

      case "control-append": {
        // Stage a contract onto ae/control (dry-run validates; --apply CAS-writes).
        const task = args.flags.task;
        const file = args.flags.file;
        const version = Number(args.flags.version ?? "1");
        if (!task || !file) {
          return emit(args.json, false, {
            message: "require --task and --file",
          });
        }
        const yaml = await readFile(file, "utf8");
        const tip = await client.getBranchTip(cfg.config.controlBranch);
        if (!tip.ok) {
          return emit(args.json, false, { message: tip.message, code: tip.code });
        }
        const preview = {
          repository: `${cfg.config.owner}/${cfg.config.repo}`,
          controlBranch: cfg.config.controlBranch,
          expectedTip: tip.data,
          task,
          version,
          apply: args.apply,
        };
        if (!args.apply) {
          return emit(args.json, true, {
            dryRun: true,
            preview,
            note: "pass --apply to stage contract onto ae/control",
          });
        }
        const store = openGitHubControlStore(client, cfg.config);
        const staged = await stageContract({
          store,
          expectedTip: tip.data,
          taskId: task,
          contractVersion: version,
          contractYaml: yaml,
          occurredAt: new Date().toISOString(),
        });
        if (!staged.ok) {
          return emit(args.json, false, {
            message: staged.issues.map((i) => i.message).join("; "),
            issues: staged.issues,
            preview,
          });
        }
        return emit(args.json, true, { preview, result: staged.value });
      }

      case "pr-evidence": {
        const pr = Number(args.flags.pr);
        if (!pr) {
          return emit(args.json, false, { message: "require --pr <number>" });
        }
        const evidence = await ingestPrEvidence(client, pr);
        if (!evidence.ok) {
          return emit(args.json, false, {
            message: evidence.message,
            code: evidence.code,
          });
        }
        return emit(args.json, true, evidence.value);
      }

      case "control-cas-probe": {
        // Internal test helper — refuse outside injected transport.
        if (!options.transport || !(options.transport instanceof FakeGitHubTransport)) {
          return emit(args.json, false, {
            message: "control-cas-probe is test-only",
          });
        }
        const tip = await client.getBranchTip(cfg.config.controlBranch);
        if (!tip.ok) {
          return emit(args.json, false, { message: tip.message });
        }
        if (!args.apply) {
          return emit(args.json, true, {
            dryRun: true,
            expectedTip: tip.data,
          });
        }
        const read = await readControlBranch(client, cfg.config);
        if (!read.ok) {
          return emit(args.json, false, { message: read.message });
        }
        const next = new Map(read.value.objects);
        const cas = await compareAndSwapControlBranch({
          client,
          config: cfg.config,
          expectedTip: tip.data,
          nextObjects: next,
          commitMessage: "ae: no-op CAS probe",
        });
        return emit(args.json, cas.ok, cas);
      }

      default:
        return emit(args.json, false, {
          message: `unknown command: ${command}`,
        });
    }
  } catch (err) {
    return emit(args.json, false, {
      message: redactSecrets(err instanceof Error ? err.message : String(err)),
    });
  }
}
