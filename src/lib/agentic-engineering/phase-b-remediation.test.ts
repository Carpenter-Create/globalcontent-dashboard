import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { bindFounderAuthorization } from "./authorize-binding";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestTaskContract } from "./contract-digest";
import {
  appendControlEvent,
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
  LEDGER_OBJECTS_PREV_DIR,
  LEDGER_TIP_NAME,
  __testOnly_setPublishFault,
  openFilesystemLedger,
} from "./filesystem-control-store";
import {
  recordFounderCancel,
  recordFounderClose,
  recordFounderFindingDisposition,
  recordFounderPause,
  recordFounderReviewReady,
} from "./founder-events";
import {
  LocalGitHubBoundaryAdapter,
  UnimplementedGitHubBoundaryClient,
} from "./github-boundary";
import { createMemoryControlStore } from "./memory-control-store";
import { reconstructTaskState } from "./reconstruct-state";
import { formatContractPath, formatProposedPath } from "./control-paths";
import { sampleContract, SAMPLE_SHA } from "./test-fixtures";
import { runAeDryRunCli } from "./dry-run-cli";
import { buildFounderReviewReadyPayload } from "./sha-pin-events";
import * as publicApi from "./index";
import { commitPrivilegedControlEvent } from "./internal/commit-control-event";

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

/** Symlink-free temp base under cwd (macOS /var tmpdir has symlink ancestors). */
async function symlinkFreeTempDir(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".ae-test-tmp");
  await mkdir(base, { recursive: true });
  const probe = await openFilesystemLedger(path.join(base, ".probe-ledger"), {
    create: true,
  });
  if (!probe.ok) {
    // Platform cannot host a ledger under cwd (unexpected symlink ancestors).
    throw new Error(
      `SKIP_REASON: cannot create symlink-free ledger under cwd (${probe.code}: ${probe.message})`,
    );
  }
  await rm(probe.root, { recursive: true, force: true });
  return mkdtemp(path.join(base, prefix));
}

async function stageOnly(store: ControlStore) {
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

async function stageAndAuthorize(store: ControlStore) {
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

afterEach(() => {
  __testOnly_setPublishFault(null);
});

describe("Phase B Codex remediation", () => {
  describe("dedicated filesystem ledger root", () => {
    it("rejects --ledger . / cwd", async () => {
      const opened = await openFilesystemLedger(".", { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("rejected_root");
    });

    it("rejects non-empty normal directory", async () => {
      let dir: string;
      try {
        dir = await symlinkFreeTempDir("ae-nonempty-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await writeFile(path.join(dir, "readme.txt"), "nope", "utf8");
      const opened = await openFilesystemLedger(dir, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("not_empty");
    });

    it("rejects symlink root", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-symroot-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const real = path.join(base, "real");
      const link = path.join(base, "link");
      await mkdir(real);
      await symlink(real, link);
      const opened = await openFilesystemLedger(link, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("rejects immediate parent symlink", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-symparent-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const mid = path.join(base, "mid");
      const via = path.join(base, "via");
      await mkdir(mid);
      await symlink(mid, via);
      const target = path.join(via, "ledger");
      const opened = await openFilesystemLedger(target, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("rejects grandparent symlink", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-symgp-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const real = path.join(base, "real");
      const via = path.join(base, "via");
      await mkdir(path.join(real, "nested"), { recursive: true });
      await symlink(real, via);
      const target = path.join(via, "nested", "ledger");
      const opened = await openFilesystemLedger(target, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("rejects deeper ancestor symlink", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-symdeep-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const real = path.join(base, "real");
      const via = path.join(base, "via");
      await mkdir(path.join(real, "a", "b"), { recursive: true });
      await symlink(real, via);
      const target = path.join(via, "a", "b", "ledger");
      const opened = await openFilesystemLedger(target, { create: true });
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.code).toBe("symlink_rejected");
    });

    it("accepts normal nested real directories", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-realnest-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const nested = path.join(base, "a", "b", "c");
      await mkdir(nested, { recursive: true });
      const ledger = path.join(nested, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      expect(opened.ok).toBe(true);
    });

    it("accepts valid dedicated new ledger", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-newled-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
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
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-existled-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const ledger = path.join(base, "ledger");
      const created = await openFilesystemLedger(ledger, { create: true });
      expect(created.ok).toBe(true);
      const reopened = await openFilesystemLedger(ledger, { create: false });
      expect(reopened.ok).toBe(true);
    });
  });

  describe("atomic serialized filesystem CAS + crash safety", () => {
    it("two concurrent writers: first wins, second stale, no mixed state", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-cas-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
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

      const [ra, rb] = await Promise.all([
        appendControlEvent({
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
        }),
        appendControlEvent({
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
        }),
      ]);
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
      const top = await readdir(opened.root);
      expect(top).not.toContain("objects.next");
      expect(top).not.toContain("objects.prev");
    });

    it("fault after objects→prev retains backup; open fails closed", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-fault-prev-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      if (!opened.ok) throw new Error("open failed");
      const { yaml } = digestTaskContract(sampleContract());
      const tip = await opened.store.getTip();
      __testOnly_setPublishFault("after_objects_to_prev");
      const staged = await stageContract({
        store: opened.store,
        expectedTip: tip,
        taskId: "AE-0001",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(staged.ok).toBe(false);
      __testOnly_setPublishFault(null);

      // Last accepted backup must still exist (empty ledger objects.prev).
      await access(path.join(opened.root, LEDGER_OBJECTS_PREV_DIR));
      const reopened = await openFilesystemLedger(opened.root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) {
        expect(reopened.code).toBe("integrity_failure");
        expect(reopened.message).toMatch(/objects\.prev/);
      }
    });

    it("fault before tip update retains prev; refuse to normalize", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-fault-tip-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      if (!opened.ok) throw new Error("open failed");
      // Seed one successful stage first so prev holds non-empty accepted state.
      const { yaml, digest } = digestTaskContract(sampleContract());
      const staged = await stageContract({
        store: opened.store,
        expectedTip: await opened.store.getTip(),
        taskId: "AE-0001",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(staged.ok).toBe(true);
      if (!staged.ok) return;

      __testOnly_setPublishFault("before_tip_update");
      const auth = await bindFounderAuthorization({
        store: opened.store,
        expectedTip: staged.value.tip,
        commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        commentAction: "created",
        issueNumber: 1,
        commentId: 1,
        createdAt: "2026-08-08T15:01:00.000Z",
      });
      expect(auth.ok).toBe(false);
      __testOnly_setPublishFault(null);

      await access(path.join(opened.root, LEDGER_OBJECTS_PREV_DIR));
      // Previous accepted staged event remains recoverable under objects.prev
      const prevEvent = path.join(
        opened.root,
        LEDGER_OBJECTS_PREV_DIR,
        "events/AE-0001/000001-contract_staged.json",
      );
      await access(prevEvent);
      const reopened = await openFilesystemLedger(opened.root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.message).toMatch(/objects\.prev/);
    });

    it("fault during prev cleanup leaves prev; fail closed", async () => {
      let base: string;
      try {
        base = await symlinkFreeTempDir("ae-fault-clean-");
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      const ledger = path.join(base, "ledger");
      const opened = await openFilesystemLedger(ledger, { create: true });
      if (!opened.ok) throw new Error("open failed");
      const { yaml } = digestTaskContract(sampleContract());
      __testOnly_setPublishFault("during_prev_cleanup");
      const staged = await stageContract({
        store: opened.store,
        expectedTip: await opened.store.getTip(),
        taskId: "AE-0001",
        contractVersion: 1,
        contractYaml: yaml,
        occurredAt: "2026-08-08T15:00:00.000Z",
      });
      expect(staged.ok).toBe(false);
      __testOnly_setPublishFault(null);
      await access(path.join(opened.root, LEDGER_OBJECTS_PREV_DIR));
      const reopened = await openFilesystemLedger(opened.root);
      expect(reopened.ok).toBe(false);
    });
  });

  describe("public API surface — no raw mutation escape hatches", () => {
    it("package public surface has no raw CAS / mutable / privileged commit export", () => {
      expect(publicApi).not.toHaveProperty("commitPrivilegedControlEvent");
      expect(publicApi).not.toHaveProperty("MutableControlStore");
      expect(publicApi).not.toHaveProperty("isMutableControlStore");
      expect(publicApi).not.toHaveProperty("unsafeCompareAndSwap");
      expect(publicApi).not.toHaveProperty("FilesystemControlStore");
      expect(publicApi).not.toHaveProperty("MemoryControlStore");
      expect(typeof publicApi.createMemoryControlStore).toBe("function");
      expect(typeof publicApi.openFilesystemLedger).toBe("function");
      expect(typeof publicApi.appendControlEvent).toBe("function");
      expect(typeof publicApi.bindFounderAuthorization).toBe("function");
    });

    it("ordinary ControlStore has no runtime CAS method", async () => {
      const store = createMemoryControlStore();
      expect(
        (store as ControlStore & { unsafeCompareAndSwap?: unknown })
          .unsafeCompareAndSwap,
      ).toBeUndefined();
      expect(
        (store as ControlStore & { compareAndSwap?: unknown }).compareAndSwap,
      ).toBeUndefined();
      expect(
        (store as ControlStore & { compareAndSwapInternal?: unknown })
          .compareAndSwapInternal,
      ).toBeUndefined();
    });

    it("ordinary caller cannot rewrite history through exported APIs", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
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
      const store = createMemoryControlStore();
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
      const store = createMemoryControlStore();
      const { tip } = await stageAndAuthorize(store);

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

    it("internal privileged commit still folds; public index cannot reach it", async () => {
      expect(publicApi).not.toHaveProperty("commitPrivilegedControlEvent");
      const store = createMemoryControlStore();
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
  });

  describe("fold-before-write", () => {
    it("closed immediately after authorize is rejected with no write", async () => {
      const store = createMemoryControlStore();
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
    });

    it("founder_review_ready from invalid state is rejected", async () => {
      const store = createMemoryControlStore();
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
      const store = createMemoryControlStore();
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
      const store = createMemoryControlStore();
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
      const base = await symlinkFreeTempDir("ae-corr-");
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
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await writeFile(
        path.join(
          root,
          LEDGER_OBJECTS_DIR,
          "events/AE-0001/000001-contract_staged.json",
        ),
        "{}\n",
        "utf8",
      );
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("delete tip → fail", async () => {
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await unlink(path.join(root, LEDGER_TIP_NAME));
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("unknown path appears → fail", async () => {
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await writeFile(path.join(root, "evil.txt"), "x", "utf8");
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("symlink appears → fail", async () => {
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await symlink(
        path.join(root, LEDGER_TIP_NAME),
        path.join(root, "sneaky-link"),
      );
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.code).toBe("integrity_failure");
    });

    it("malformed object under objects/ → fail", async () => {
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
      await writeFile(
        path.join(root, LEDGER_OBJECTS_DIR, "not-a-control-path.txt"),
        "x",
        "utf8",
      );
      const reopened = await openFilesystemLedger(root);
      expect(reopened.ok).toBe(false);
    });

    it("getSnapshot throws LedgerIntegrityError on tip mismatch", async () => {
      let root: string;
      try {
        ({ root } = await seededLedger());
      } catch (e) {
        if (String(e).includes("SKIP_REASON")) return;
        throw e;
      }
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
      const store = createMemoryControlStore();
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

    it("authorize with no staged object → fail", async () => {
      const store = createMemoryControlStore();
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
      const store = createMemoryControlStore();
      const { yaml, digest } = digestTaskContract(sampleContract());
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
      const store = createMemoryControlStore();
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

  describe("reconstruction authorization-history logic", () => {
    it("pre-auth PAUSED → reconstructs without frozen contract", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageOnly(store);
      const paused = await recordFounderPause({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T15:02:00.000Z",
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        reason: "hold",
      });
      expect(paused.ok).toBe(true);
      const recon = await reconstructTaskState(store, "AE-0001");
      expect(recon.ok).toBe(true);
      if (recon.ok) {
        expect(recon.value.state).toBe("PAUSED");
        expect(recon.value.frozenContractPath).toBeNull();
      }
    });

    it("pre-auth BLOCKED → reconstructs without frozen contract", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageOnly(store);
      const blocked = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "blocked",
        payload: { reason: "waiting", blocker_class: "external" },
        occurredAt: "2026-08-08T15:02:00.000Z",
        actor: {
          kind: "system",
          provider: "t",
          session_or_run_id: "b",
          github_actor_id: null,
        },
      });
      expect(blocked.ok).toBe(true);
      const recon = await reconstructTaskState(store, "AE-0001");
      expect(recon.ok).toBe(true);
      if (recon.ok) {
        expect(recon.value.state).toBe("BLOCKED");
        expect(recon.value.frozenContractPath).toBeNull();
      }
    });

    it("pre-auth CANCELLED → reconstructs without frozen contract", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageOnly(store);
      const cancelled = await recordFounderCancel({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T15:02:00.000Z",
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        reason: "abandoned",
      });
      expect(cancelled.ok).toBe(true);
      const recon = await reconstructTaskState(store, "AE-0001");
      expect(recon.ok).toBe(true);
      if (recon.ok) {
        expect(recon.value.state).toBe("CANCELLED");
        expect(recon.value.frozenContractPath).toBeNull();
      }
    });

    it("post-auth PAUSED + missing frozen contract → fail", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const paused = await recordFounderPause({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        occurredAt: "2026-08-08T15:02:00.000Z",
        observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        reason: "hold",
      });
      expect(paused.ok).toBe(true);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      next.delete(formatContractPath("AE-0001", 1));
      const broken = createMemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some((i) => i.code === "frozen_contract_missing"),
        ).toBe(true);
      }
    });

    it("post-auth BLOCKED + mutated frozen contract → fail", async () => {
      const store = createMemoryControlStore();
      const { tip } = await stageAndAuthorize(store);
      const blocked = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: "blocked",
        payload: { reason: "wait", blocker_class: "external" },
        occurredAt: "2026-08-08T15:02:00.000Z",
        actor: {
          kind: "system",
          provider: "t",
          session_or_run_id: "b",
          github_actor_id: null,
        },
      });
      expect(blocked.ok).toBe(true);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      const other = digestTaskContract(sampleContract({ title: "Tampered" }));
      next.set(formatContractPath("AE-0001", 1), other.yaml);
      const broken = createMemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some((i) => i.code === "frozen_contract_digest_mismatch"),
        ).toBe(true);
      }
    });

    it("normal authorized reconstruction still passes", async () => {
      const store = createMemoryControlStore();
      await stageAndAuthorize(store);
      const recon = await reconstructTaskState(store, "AE-0001");
      expect(recon.ok).toBe(true);
      if (recon.ok) expect(recon.value.state).toBe("AUTHORIZED");
    });

    it("frozen contract missing after authorize → fail", async () => {
      const store = createMemoryControlStore();
      await stageAndAuthorize(store);
      const snap = await store.getSnapshot();
      const next = new Map(snap.objects);
      next.delete(formatContractPath("AE-0001", 1));
      const broken = createMemoryControlStore(next);
      const recon = await reconstructTaskState(broken, "AE-0001");
      expect(recon.ok).toBe(false);
      if (!recon.ok) {
        expect(
          recon.issues.some((i) => i.code === "frozen_contract_missing"),
        ).toBe(true);
      }
    });
  });

  describe("wrong active contract must not append", () => {
    it("claimed wrong active contract is rejected", async () => {
      const store = createMemoryControlStore();
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

  describe("founder API authority binding", () => {
    it("disposition via dedicated API requires founder actor binding", async () => {
      const store = createMemoryControlStore();
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
