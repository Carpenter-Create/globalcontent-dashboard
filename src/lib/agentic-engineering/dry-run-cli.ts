import { readFile } from "node:fs/promises";

import { bindFounderAuthorization } from "./authorize-binding";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestContractFileBytes } from "./contract-digest";
import {
  appendControlEvent,
  stageContract,
  readTaskEventChain,
} from "./control-ledger";
import { assertCanonicalContractYaml } from "./contract-yaml";
import type { ControlStore } from "./control-store";
import { openFilesystemLedger } from "./filesystem-control-store";
import {
  recordFounderClose,
  recordFounderFindingDisposition,
  recordFounderPause,
  recordFounderResume,
  recordFounderCancel,
} from "./founder-events";
import { isPrivilegedEventType } from "./privileged-events";
import { reconstructTaskState } from "./reconstruct-state";
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

async function ensureStore(ledger: string): Promise<ControlStore> {
  const opened = await openFilesystemLedger(ledger, { create: true });
  if (!opened.ok) {
    throw new Error(`${opened.code}: ${opened.message}`);
  }
  return opened.store;
}

/**
 * Supervised Phase B dry-run CLI dispatcher.
 * Local files only — no GitHub network writes, no env/secret reads.
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
        "  append-event --type <operational_event_type> --payload-file <path> --task <id>",
        "              [--contract-version <n> --contract-digest <d>]  (must match derived pins)",
        "  founder-disposition --task <id> --finding-id <id> --disposition <d> --actor <id> --occurred-at <iso>",
        "  founder-pause --task <id> --reason <r> --actor <id> --occurred-at <iso>",
        "  founder-resume --task <id> --actor <id> --occurred-at <iso>",
        "  founder-cancel --task <id> --reason <r> --actor <id> --occurred-at <iso>",
        "  founder-close --task <id> --merge-sha <sha> --actor <id> --occurred-at <iso>",
        "  verify-chain --task <AE-####>",
        "  reconstruct-state --task <AE-####>",
        "",
        "Flags: --ledger <dedicated-dir>  --json",
        "Ledger must be a dedicated marked directory (not repo root / home / arbitrary non-empty).",
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
        if (!type || !payloadFile || !task) {
          return emit(
            args.json,
            false,
            "usage: append-event --type <operational> --payload-file <p> --task <id> [--contract-version <n> --contract-digest <d>]",
          );
        }
        if (isPrivilegedEventType(type)) {
          return emit(
            args.json,
            false,
            `privileged event type rejected on append-event: ${type} (use dedicated founder / stage / authorize commands)`,
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const payload = JSON.parse(await readFile(payloadFile, "utf8")) as Record<
          string,
          unknown
        >;
        const claimedVersion = args.flags["contract-version"];
        const claimedDigest = args.flags["contract-digest"];
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
          claimedActiveContractVersion: claimedVersion
            ? Number(claimedVersion)
            : undefined,
          claimedActiveContractDigest: claimedDigest,
        });
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          eventPath: result.value.eventPath,
          eventDigest: result.value.event.event_digest,
        });
      }
      case "founder-disposition": {
        const task = args.flags.task;
        const findingId = args.flags["finding-id"];
        const disposition = args.flags.disposition as
          | "accepted_by_founder"
          | "deferred"
          | "wont_fix_founder"
          | undefined;
        const actor = Number(args.flags.actor);
        const occurredAt = args.flags["occurred-at"];
        if (!task || !findingId || !disposition || !actor || !occurredAt) {
          return emit(
            args.json,
            false,
            "usage: founder-disposition --task <id> --finding-id <id> --disposition <d> --actor <id> --occurred-at <iso>",
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const result = await recordFounderFindingDisposition({
          store,
          expectedTip: tip,
          taskId: task,
          occurredAt,
          observedFounderActorId: actor,
          findingId,
          disposition,
        });
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          eventPath: result.value.eventPath,
        });
      }
      case "founder-pause":
      case "founder-resume":
      case "founder-cancel":
      case "founder-close": {
        const task = args.flags.task;
        const actor = Number(args.flags.actor);
        const occurredAt = args.flags["occurred-at"];
        if (!task || !actor || !occurredAt) {
          return emit(
            args.json,
            false,
            `usage: ${args.command} --task <id> --actor <id> --occurred-at <iso> ...`,
          );
        }
        const store = await ensureStore(args.ledger);
        const tip = await store.getTip();
        const base = {
          store,
          expectedTip: tip,
          taskId: task,
          occurredAt,
          observedFounderActorId: actor,
        };
        let result;
        if (args.command === "founder-pause") {
          const reason = args.flags.reason;
          if (!reason) return emit(args.json, false, "missing --reason");
          result = await recordFounderPause({ ...base, reason });
        } else if (args.command === "founder-resume") {
          result = await recordFounderResume(base);
        } else if (args.command === "founder-cancel") {
          const reason = args.flags.reason;
          if (!reason) return emit(args.json, false, "missing --reason");
          result = await recordFounderCancel({ ...base, reason });
        } else {
          const mergeSha = args.flags["merge-sha"];
          if (!mergeSha) return emit(args.json, false, "missing --merge-sha");
          result = await recordFounderClose({ ...base, mergeSha });
        }
        if (!result.ok) return emit(args.json, false, result.issues);
        return emit(args.json, true, {
          tip: result.value.tip,
          eventPath: result.value.eventPath,
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
