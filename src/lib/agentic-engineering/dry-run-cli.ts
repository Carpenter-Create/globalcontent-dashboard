import { readFile } from "node:fs/promises";
import path from "node:path";

import { bindFounderAuthorization } from "./authorize-binding";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestContractFileBytes } from "./contract-digest";
import {
  appendControlEvent,
  stageContract,
} from "./control-ledger";
import { FilesystemControlStore } from "./filesystem-control-store";
import { readTaskEventChain } from "./control-ledger";
import { reconstructTaskState } from "./reconstruct-state";
import { assertCanonicalContractYaml } from "./contract-yaml";
import type { ControlEventType } from "./event-schema";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ParsedArgs = {
  command: string | null;
  json: boolean;
  ledger: string;
  flags: Record<string, string>;
  positionals: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  let json = false;
  let ledger = ".ae-control-dry-run";
  let command: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--ledger") {
      ledger = argv[++i] ?? ledger;
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
  return { command, json, ledger, flags, positionals };
}

function emit(
  jsonMode: boolean,
  ok: boolean,
  data: unknown,
): CliResult {
  if (jsonMode) {
    return {
      exitCode: ok ? 0 : 1,
      stdout: `${JSON.stringify({ ok, data }, null, 2)}\n`,
      stderr: "",
    };
  }
  if (ok) {
    return {
      exitCode: 0,
      stdout: typeof data === "string" ? `${data}\n` : `${JSON.stringify(data, null, 2)}\n`,
      stderr: "",
    };
  }
  return {
    exitCode: 1,
    stdout: "",
    stderr:
      typeof data === "string"
        ? `${data}\n`
        : `${JSON.stringify(data, null, 2)}\n`,
  };
}

async function ensureStore(ledger: string): Promise<FilesystemControlStore> {
  const store = new FilesystemControlStore(path.resolve(ledger));
  await store.initEmpty();
  return store;
}

/**
 * Supervised Phase B dry-run CLI dispatcher.
 * Local files only — no GitHub network writes.
 */
export async function runAeDryRunCli(argv: string[]): Promise<CliResult> {
  const args = parseArgs(argv);
  if (!args.command || args.command === "help" || args.flags.help === "true") {
    return emit(
      args.json,
      true,
      [
        "ae-dry-run commands:",
        "  validate-contract --file <path>",
        "  stage-contract --file <path> --task <AE-####> --version <n>",
        "  authorize --comment-file <path> --actor <id> --issue <n> --comment-id <n> --created-at <iso>",
        "  append-event --type <event_type> --payload-file <path> --task <id> --contract-version <n> --contract-digest <d>",
        "  verify-chain --task <AE-####>",
        "  reconstruct-state --task <AE-####>",
        "",
        "Flags: --ledger <dir>  --json",
      ].join("\n"),
    );
  }

  try {
    switch (args.command) {
      case "validate-contract": {
        const file = args.flags.file;
        if (!file) return emit(args.json, false, "missing --file");
        const yaml = await readFile(file, "utf8");
        assertCanonicalContractYaml(yaml);
        const digest = digestContractFileBytes(yaml);
        return emit(args.json, true, { digest, bytes: Buffer.byteLength(yaml) });
      }
      case "stage-contract": {
        const file = args.flags.file;
        const task = args.flags.task;
        const version = Number(args.flags.version);
        if (!file || !task || !Number.isInteger(version) || version < 1) {
          return emit(
            args.json,
            false,
            "usage: stage-contract --file <path> --task <AE-####> --version <n>",
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const yaml = await readFile(file, "utf8");
        const result = await stageContract({
          store,
          expectedTip: tip,
          taskId: task,
          contractVersion: version,
          contractYaml: yaml,
          occurredAt: args.flags["occurred-at"] ?? new Date().toISOString(),
        });
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          digest: result.value.digest,
          proposedPath: result.value.proposedPath,
          eventPath: result.value.eventPath,
        });
      }
      case "authorize": {
        const commentFile = args.flags["comment-file"];
        const actor = Number(args.flags.actor);
        const issue = Number(args.flags.issue);
        const commentId = Number(args.flags["comment-id"]);
        const createdAt = args.flags["created-at"];
        const action = args.flags.action ?? "created";
        if (!commentFile || !createdAt || !actor || !issue || !commentId) {
          return emit(
            args.json,
            false,
            "usage: authorize --comment-file <path> --actor <id> --issue <n> --comment-id <n> --created-at <iso>",
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const body = await readFile(commentFile, "utf8");
        const result = await bindFounderAuthorization({
          store,
          expectedTip: tip,
          commentBody: body,
          observedFounderActorId: actor,
          expectedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
          commentAction: action,
          issueNumber: issue,
          commentId,
          createdAt,
        });
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          contractPath: result.value.contractPath,
          contractDigest: result.value.contractDigest,
          eventPath: result.value.eventPath,
        });
      }
      case "append-event": {
        const type = args.flags.type as ControlEventType | undefined;
        const payloadFile = args.flags["payload-file"];
        const task = args.flags.task;
        const contractVersion = Number(args.flags["contract-version"]);
        const contractDigest = args.flags["contract-digest"];
        if (!type || !payloadFile || !task || !contractDigest || !contractVersion) {
          return emit(
            args.json,
            false,
            "usage: append-event --type <t> --payload-file <p> --task <id> --contract-version <n> --contract-digest <d>",
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const payload = JSON.parse(await readFile(payloadFile, "utf8")) as Record<
          string,
          unknown
        >;
        const result = await appendControlEvent({
          store,
          expectedTip: tip,
          taskId: task,
          eventType: type,
          payload,
          occurredAt: args.flags["occurred-at"] ?? new Date().toISOString(),
          actor: {
            kind: "orchestrator",
            provider: "phase-b-dry-run",
            session_or_run_id: args.flags.session ?? "cli",
            github_actor_id: null,
          },
          activeContractVersion: contractVersion,
          activeContractDigest: contractDigest,
        });
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          eventPath: result.value.eventPath,
          eventDigest: result.value.event.event_digest,
        });
      }
      case "verify-chain": {
        const task = args.flags.task;
        if (!task) return emit(args.json, false, "missing --task");
        const store = await ensureStore(args.ledger);
        const snap = await store.getSnapshot();
        const chain = readTaskEventChain(snap.objects, task);
        if (!chain.ok) return emit(args.json, false, chain.issues);
        return emit(args.json, true, {
          tip: snap.tip,
          eventCount: chain.value.length,
          latestDigest: chain.value[chain.value.length - 1]?.event_digest,
        });
      }
      case "reconstruct-state": {
        const task = args.flags.task;
        if (!task) return emit(args.json, false, "missing --task");
        const store = await ensureStore(args.ledger);
        const result = await reconstructTaskState(store, task);
        if (!result.ok) return emit(args.json, false, result.issues);
        const { events: _e, folded: _f, ...rest } = result.value;
        void _e;
        void _f;
        return emit(args.json, true, rest);
      }
      default:
        return emit(args.json, false, `unknown command: ${args.command}`);
    }
  } catch (e) {
    return emit(args.json, false, (e as Error).message);
  }
}
