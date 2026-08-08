import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bindFounderAuthorization } from "./authorize-binding";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestTaskContract } from "./contract-digest";
import {
  appendControlEvent,
  commitPrivilegedControlEvent,
  stageContract,
} from "./control-ledger";
import {
  EMPTY_CONTROL_TIP,
  LedgerIntegrityError,
  type ControlStore,
} from "./control-store";
import {
  LEDGER_MARKER_NAME,
  LEDGER_OBJECTS_DIR,
  LEDGER_TIP_NAME,
  openFilesystemLedger,
} from "./filesystem-control-store";
import {
  recordFounderClose,
  recordFounderFindingDisposition,
  recordFounderReviewReady,
} from "./founder-events";
import {
  LocalGitHubBoundaryAdapter,
  UnimplementedGitHubBoundaryClient,
} from "./github-boundary";
import { MemoryControlStore } from "./memory-control-store";
import { reconstructTaskState } from "./reconstruct-state";
import { formatContractPath, formatProposedPath } from "./control-paths";
import { sampleContract, SAMPLE_SHA } from "./test-fixtures";
import { runAeDryRunCli } from "./dry-run-cli";
import { buildFounderReviewReadyPayload } from "./sha-pin-events";

function authComment(
  taskId: string,
  version: number,
  digest: string,
  baseSha: string,
) {
  return [
    "AE-AUTHORIZE",
    `task_id: ${taskId}`,
    `contract_version: ${version}`,
    `contract_digest: ${digest}`,
    `base_sha: ${baseSha}`,
  ].join("\n");
}

async function stageOnly(store: MemoryControlStore) {
  const { yaml, digest } = digestTaskContract(sampleContract());
  const staged = await stageContract({
    store,
    expectedTip: await store.getTip(),
    taskId: "AE-0001",
    contractVersion: 1,
    contractYaml: yaml,
    occurredAt: "2026-08-08T15:00:00.000Z",
  });
  expect(staged.ok).toBe(true);
  if (!staged.ok) throw new Error("stage failed");
  return { tip: staged.value.tip, digest, yaml };
}

async function stageAndAuthorize(store: MemoryControlStore) {
  const { tip, digest, yaml } = await stageOnly(store);
  const auth = await bindFounderAuthorization({
    store,
    expectedTip: tip,
    commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
    observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
    commentAction: "created",
    issueNumber: 1,
    commentId: 1,
    createdAt: "2026-08-08T15:01:00.000Z",
  });
  expect(auth.ok).toBe(true);
  if (!auth.ok) throw new Error("auth failed");
  return { tip: auth.value.tip, digest, yaml };
}

describe("Phase B Codex remediation", () => {
  describe("dedicated filesystem ledger root", () => {
    it("rejects --ledger . / cwd", async () => {
      const opened = await openFilesystemLedger(".", { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("rejected_root");

      const cli = await runAeDryRunCli([
        "verify-chain",
        "--ledger",
        ".",
        "--task",
        "AE-0001",
        "--json",
      ]);
      expect(cli.exitCode).not.toBe(0);
    });

    it("rejects non-empty normal directory", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "ae-nonempty-"));
      await writeFile(path.join(dir, "readme.txt"), "nope", "utf8");
      const opened = await openFilesystemLedger(dir, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("not_empty");
    });

    it("rejects symlink root", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "ae-symroot-"));
      const real = path.join(base, "real");
      const link = path.join(base, "link");
      await mkdir(real);
      await symlink(real, link);
      const opened = await openFilesystemLedger(link, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("rejects symlink component in path", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "ae-symcomp-"));
      const mid = path.join(base, "mid");
      const link = path.join(base, "via");
      await mkdir(mid);
      await symlink(mid, link);
      const target = path.join(link, "ledger");
      const opened = await openFilesystemLedger(target, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("accepts valid dedicated new ledger", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "ae-newled-"));
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const marker = await readFile(
        path.join(opened.root, LEDGER_MARKER_NAME),
        "utf8",
      );
      expect(marker).toContain("ae-control-ledger");
      expect(await opened.store.getTip()).toBe(EMPTY_CONTROL_TIP);
    });

    it("accepts valid existing marked ledger", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "ae-existled-"));
      const ledger = path.join(base, "ledger");
      const created = await openFilesystemLedger(ledger, { create: true });
      expect(created.ok).toBe(true);
      const reopened = await openFilesystemLedger(ledger, { create: false });
      expect(reopened.ok).toBe(true);
    });
  });

  describe("atomic serialized filesystem CAS", () => {
    it("two concurrent writers: first wins, second stale, no mixed state", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "ae-cas-"));
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const store = opened.store;

      const { yaml, digest } = digestTaskContract(sampleContract());
      const staged = await stageContract({
        store,
        expectedTip: await store.getTip(),
        taskId: "AE-0001",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(staged.ok).toBe(true);
      if (!staged.ok) return;
      const auth = await bindFounderAuthorization({
        store,
        expectedTip: staged.value.tip,
        commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        commentAction: "created",
        issueNumber: 1,
        commentId: 1,
        createdAt: "2026-08-08T15:01:00.000Z",
      });
      expect(auth.ok).toBe(true);
      if (!auth.ok) return;
      const tip = auth.value.tip;

      const a = appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "implementation_started",
        payload: { session_or_run_id: "a", provider: "cursor" },
        occurredAt: "2026-08-08T16:00:00.000Z",
        actor: {
          kind: "orchestrator",
          provider: "t",
          session_or_run_id: "a",
          github_actor_id: null,
        },
      });
      const b = appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "implementation_started",
        payload: { session_or_run_id: "b", provider: "cursor" },
        occurredAt: "2026-08-08T16:00:01.000Z",
        actor: {
          kind: "orchestrator",
          provider: "t",
          session_or_run_id: "b",
          github_actor_id: null,
        },
      });

      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
      const failed = ra.ok ? rb : ra;
      if (!failed.ok) {
        expect(failed.issues.some((i) => i.code === "stale_tip")).toBe(true);
      }

      const snap = await store.getSnapshot();
      const implEvents = [...snap.objects.keys()].filter((p) =>
        p.includes("implementation_started"),
      );
      expect(implEvents).toHaveLength(1);
      // No partial publish artifacts
      const { readdir } = await import("node:fs/promises");
      const top = await readdir(opened.root);
      expect(top).not.toContain("objects.next");
      expect(top).not.toContain("objects.prev");
      expect(top).not.toContain(".control-tip.next");
    });
  });

  describe("constrained storage API", () => {
    it("public ControlStore has no compareAndSwap; historical rewrite not via public append", async () => {
      const store: ControlStore = new MemoryControlStore();
      expect(
        (store as ControlStore & { compareAndSwap?: unknown }).compareAndSwap,
      ).toBeUndefined();

      const { tip } = await stageAndAuthorize(store as MemoryControlStore);
      // Cannot rewrite history through operational append — only create-once new events.
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "authorize",
        payload: {
          contract_version: 1,
          contract_digest: "sha256:" + "a".repeat(64),
          founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
          base_sha: SAMPLE_SHA,
          issue_number: 1,
          comment_id: 99,
          authorized_at: "2026-08-08T15:01:00.000Z",
        },
        occurredAt: "2026-08-08T15:01:00.000Z",
        actor: {
          kind: "founder",
          provider: "github",
          session_or_run_id: "x",
          github_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "privileged_event_rejected"),
        ).toBe(true);
      }
    });

    it("GitHub boundary refuses write transactions and never exposes raw CAS", async () => {
      const store = new MemoryControlStore();
      const local = new LocalGitHubBoundaryAdapter(store);
      const refused = await local.proposeConstrainedTransaction(
        "ae/control",
        await store.getTip(),
        { kind: "append_operational_event", description: "test" },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("not_activated");

      const remote = new UnimplementedGitHubBoundaryClient();
      await expect(remote.proposeConstrainedTransaction()).rejects.toThrow(
        /not activated/,
      );
    });
  });

  describe("privileged event routing", () => {
    it("generic append rejects authorize / finding_disposition / founder_review_ready", async () => {
      const store = new MemoryControlStore();
      const { tip, digest } = await stageAndAuthorize(store);

      for (const type of [
        "authorize",
        "finding_disposition",
        "founder_review_ready",
        "closed",
        "paused",
        "cancelled",
      ] as const) {
        const r = await appendControlEvent({
          store,
          expectedTip: tip,
          taskId: "AE-0001",
          eventType: type,
          payload: { founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID },
          occurredAt: "2026-08-08T16:00:00.000Z",
          actor: {
            kind: "founder",
            provider: "github",
            session_or_run_id: "x",
            github_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
          },
        });
        expect(r.ok, type).toBe(false);
        if (!r.ok) {
          expect(
            r.issues.some((i) => i.code === "privileged_event_rejected"),
          ).toBe(true);
        }
      }
      void digest;

      const cli = await runAeDryRunCli([
        "append-event",
        "--type",
        "authorize",
        "--payload-file",
        "/dev/null",
        "--task",
        "AE-0001",
        "--json",
      ]);
      expect(cli.exitCode).not.toBe(0);
      expect(cli.stderr + cli.stdout).toMatch(/privileged/i);
    });
  });

  describe("fold-before-write", () => {
    it("closed immediately after authorize is rejected with no write", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const before = await store.getSnapshot();

      const r = await recordFounderClose({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T16:00:00.000Z",
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        mergeSha: SAMPLE_SHA,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.code.startsWith("fold_"))).toBe(true);
      }
      expect(await store.getTip()).toBe(before.tip);
      expect((await store.getSnapshot()).objects.size).toBe(before.objects.size);
    });

    it("founder_review_ready from invalid state is rejected", async () => {
      const store = new MemoryControlStore();
      const { tip, digest } = await stageAndAuthorize(store);
      const r = await recordFounderReviewReady({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T16:00:00.000Z",
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        closureReadiness: { ready: true, reasons: [] },
        payload: buildFounderReviewReadyPayload({
          implementationSha: SAMPLE_SHA,
          validatedSha: SAMPLE_SHA,
          reviewedSha: SAMPLE_SHA,
          activeContractVersion: 1,
          activeContractDigest: digest,
          closureEvidenceRef: "c",
          predicateResultId: "p",
        }),
      });
      expect(r.ok).toBe(false);
    });

    it("invalid remediation transition is rejected before write", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const before = await store.getTip();
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "remediation_started",
        payload: { session_or_run_id: "r", provider: "cursor" },
        occurredAt: "2026-08-08T16:00:00.000Z",
        actor: {
          kind: "orchestrator",
          provider: "t",
          session_or_run_id: "r",
          github_actor_id: null,
        },
      });
      expect(r.ok).toBe(false);
      expect(await store.getTip()).toBe(before);
    });

    it("valid operational transition is accepted", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "implementation_started",
        payload: { session_or_run_id: "i", provider: "cursor" },
        occurredAt: "2026-08-08T16:00:00.000Z",
        actor: {
          kind: "orchestrator",
          provider: "t",
          session_or_run_id: "i",
          github_actor_id: null,
        },
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("filesystem corruption fail-closed", () => {
    async function seededLedger() {
      const base = await mkdtemp(path.join(tmpdir(), "ae-corr-"));
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      if (!opened.ok) throw new Error("open failed");
      const { yaml, digest } = digestTaskContract(sampleContract());
      const staged = await stageContract({
        store: opened.store,
        expectedTip: await opened.store.getTip(),
        taskId: "AE-0001",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      if (!staged.ok) throw new Error("stage failed");
      return { root: opened.root, digest, tip: staged.value.tip };
    }

    it("alter object while tip unchanged → fail", async () => {
      const { root } = await seededLedger();
      const eventRel = path.join(
        LEDGER_OBJECTS_DIR,
        "events/AE-0001/000001-contract_staged.json",
      );
      await writeFile(path.join(root, eventRel), "{}\n", "utf8");
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("delete tip → fail", async () => {
      const { root } = await seededLedger();
      await unlink(path.join(root, LEDGER_TIP_NAME));
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("unknown path appears → fail", async () => {
      const { root } = await seededLedger();
      await writeFile(path.join(root, "evil.txt"), "x", "utf8");
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("symlink appears → fail", async () => {
      const { root } = await seededLedger();
      await symlink(
        path.join(root, LEDGER_TIP_NAME),
        path.join(root, "sneaky-link"),
      );
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("malformed object under objects/ → fail", async () => {
      const { root } = await seededLedger();
      await writeFile(
        path.join(root, LEDGER_OBJECTS_DIR, "not-a-control-path.txt"),
        "x",
        "utf8",
      );
      // Tip still old — either tip mismatch or unknown path during walk.
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
    });

    it("getSnapshot throws LedgerIntegrityError on tip mismatch", async () => {
      const { root } = await seededLedger();
      const opened = await openFilesystemLedger(root);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      await writeFile(
        path.join(
          root,
          LEDGER_OBJECTS_DIR,
          "events/AE-0001/000001-contract_staged.json",
        ),
        "{}\n",
        "utf8",
      );
      await expect(opened.store.getSnapshot()).rejects.toBeInstanceOf(
        LedgerIntegrityError,
      );
    });
  });

  describe("staged provenance + authorize", () => {
    it("staged path task mismatch → fail", async () => {
      const store = new MemoryControlStore();
      const { yaml } = digestTaskContract(sampleContract({ task_id: "AE-0001" }));
      const r = await stageContract({
        store,
        expectedTip: await store.getTip(),
        taskId: "AE-0002",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "staged_path_task_mismatch"),
        ).toBe(true);
      }
    });

    it("staged path version mismatch → fail", async () => {
      const store = new MemoryControlStore();
      const { yaml } = digestTaskContract(
        sampleContract({ contract_version: 1 }),
      );
      const r = await stageContract({
        store,
        expectedTip: await store.getTip(),
        taskId: "AE-0001",
        contractVersion: 2,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "staged_path_version_mismatch"),
        ).toBe(true);
      }
    });

    it("authorize with no staged object → fail", async () => {
      const store = new MemoryControlStore();
      const { digest } = digestTaskContract(sampleContract());
      const r = await bindFounderAuthorization({
        store,
        expectedTip: await store.getTip(),
        commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        commentAction: "created",
        issueNumber: 1,
        commentId: 1,
        createdAt: "2026-08-08T15:01:00.000Z",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "missing_staged_contract"),
        ).toBe(true);
      }
    });

    it("supplied external YAML cannot substitute for staged object", async () => {
      const store = new MemoryControlStore();
      const { yaml, digest } = digestTaskContract(sampleContract());
      // Even if a caller smuggles YAML via an untyped bag, binding reads only
      // the store's proposed object — missing staged bytes still fail closed.
      const sneaky = {
        store,
        expectedTip: await store.getTip(),
        commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        commentAction: "created" as const,
        issueNumber: 1,
        commentId: 1,
        createdAt: "2026-08-08T15:01:00.000Z",
        stagedContractYaml: yaml,
      };
      const r = await bindFounderAuthorization(
        sneaky as Parameters<typeof bindFounderAuthorization>[0],
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "missing_staged_contract"),
        ).toBe(true);
      }
    });

    it("valid staged object authorizes", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      expect(tip).toMatch(/^tip:/);
      expect(
        (await store.readObject(formatProposedPath("AE-0001", 1))) != null,
      ).toBe(true);
      expect(
        (await store.readObject(formatContractPath("AE-0001", 1))) != null,
      ).toBe(true);
    });
  });

  describe("frozen contract reconstruction", () => {
    it("frozen contract missing → fail", async () => {
      const store = new MemoryControlStore();
      await stageAndAuthorize(store);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      next.delete(formatContractPath("AE-0001", 1));
      // Rebuild tip for memory store by constructing with altered objects —
      // MemoryControlStore constructor recomputes tip from objects.
      const broken = new MemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some((i) => i.code === "frozen_contract_missing"),
        ).toBe(true);
      }
    });

    it("frozen bytes changed → fail", async () => {
      const store = new MemoryControlStore();
      await stageAndAuthorize(store);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      const other = digestTaskContract(sampleContract({ title: "Tampered" }));
      next.set(formatContractPath("AE-0001", 1), other.yaml);
      const broken = new MemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some((i) => i.code === "frozen_contract_digest_mismatch"),
        ).toBe(true);
      }
    });

    it("wrong task/version in frozen contract → fail", async () => {
      const store = new MemoryControlStore();
      await stageAndAuthorize(store);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      const wrong = digestTaskContract(
        sampleContract({ task_id: "AE-0099", contract_version: 1 }),
      );
      next.set(formatContractPath("AE-0001", 1), wrong.yaml);
      const broken = new MemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some(
            (i) =>
              i.code === "frozen_contract_digest_mismatch" ||
              i.code === "frozen_contract_identity_mismatch",
          ),
        ).toBe(true);
      }
    });

    it("correct frozen contract → pass", async () => {
      const store = new MemoryControlStore();
      await stageAndAuthorize(store);
      const recon = await reconstructTaskState(store, "AE-0001");
      expect(recon.ok).toBe(true);
      if (recon.ok) expect(recon.value.state).toBe("AUTHORIZED");
    });
  });

  describe("wrong active contract must not append", () => {
    it("claimed wrong active contract is rejected", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "implementation_started",
        payload: { session_or_run_id: "x", provider: "cursor" },
        occurredAt: "2026-08-08T16:00:00.000Z",
        actor: {
          kind: "orchestrator",
          provider: "t",
          session_or_run_id: "x",
          github_actor_id: null,
        },
        claimedActiveContractVersion: 99,
        claimedActiveContractDigest: "sha256:" + "b".repeat(64),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === "active_contract_mismatch"),
        ).toBe(true);
      }
    });
  });

  describe("privileged commit still folds", () => {
    it("fabricated authorize via privileged commit still needs valid fold/chain", async () => {
      const store = new MemoryControlStore();
      // Empty store — authorize without stage should fail fold/chain.
      const r = await commitPrivilegedControlEvent({
        store,
        expectedTip: await store.getTip(),
        taskId: "AE-0001",
        eventType: "authorize",
        payload: {
          contract_version: 1,
          contract_digest: "sha256:" + "a".repeat(64),
          founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
          base_sha: SAMPLE_SHA,
          issue_number: 1,
          comment_id: 1,
          authorized_at: "2026-08-08T15:01:00.000Z",
        },
        occurredAt: "2026-08-08T15:01:00.000Z",
        actor: {
          kind: "founder",
          provider: "github",
          session_or_run_id: "x",
          github_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        },
        overrideActiveContract: {
          version: 1,
          digest: "sha256:" + "a".repeat(64),
        },
      });
      expect(r.ok).toBe(false);
    });

    it("disposition via dedicated API requires founder actor binding", async () => {
      const store = new MemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const r = await recordFounderFindingDisposition({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T16:00:00.000Z",
        observedFounderActorId: 1,
        findingId: "F1",
        disposition: "accepted_by_founder",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.some((i) => i.code === "founder_actor_mismatch")).toBe(
          true,
        );
      }
    });
  });
});
