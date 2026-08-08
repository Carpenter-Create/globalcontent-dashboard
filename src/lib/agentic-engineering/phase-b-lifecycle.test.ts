import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bindFounderAuthorization } from "./authorize-binding";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestTaskContract } from "./contract-digest";
import {
  appendControlEvent,
  stageContract,
} from "./control-ledger";
import { MemoryControlStore } from "./memory-control-store";
import { reconstructTaskState } from "./reconstruct-state";
import {
  buildFounderReviewReadyPayload,
  buildImplementationDeclaredPayload,
  buildReviewCompletedPayload,
  buildReviewStartedPayload,
  buildStaleReviewPayload,
  buildValidationCompletedPayload,
} from "./sha-pin-events";
import { sampleContract, SAMPLE_SHA, SAMPLE_SHA_B } from "./test-fixtures";
import { runAeDryRunCli } from "./dry-run-cli";
import { FilesystemControlStore } from "./filesystem-control-store";
import { formatContractPath } from "./control-paths";
import { cloneObjects, contentDigestMap } from "./control-store";
import { verifyProtectedObjectDelta } from "./protected-delta";

function authComment(taskId: string, version: number, digest: string, baseSha: string) {
  return [
    "AE-AUTHORIZE",
    `task_id: ${taskId}`,
    `contract_version: ${version}`,
    `contract_digest: ${digest}`,
    `base_sha: ${baseSha}`,
  ].join("\n");
}

async function stageAndAuthorize(store: MemoryControlStore) {
  const { yaml, digest } = digestTaskContract(sampleContract());
  let tip = await store.getTip();
  const staged = await stageContract({
    store,
    expectedTip: tip,
    taskId: "AE-0001",
    contractVersion: 1,
    contractYaml: yaml,
    occurredAt: "2026-08-08T15:00:00.000Z",
  });
  expect(staged.ok).toBe(true);
  if (!staged.ok) throw new Error("stage failed");
  tip = staged.value.tip;

  const auth = await bindFounderAuthorization({
    store,
    expectedTip: tip,
    commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA),
    observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
    commentAction: "created",
    issueNumber: 100,
    commentId: 200,
    createdAt: "2026-08-08T15:01:00.000Z",
  });
  expect(auth.ok).toBe(true);
  if (!auth.ok) throw new Error("auth failed");
  return { tip: auth.value.tip, digest, yaml };
}

describe("Phase B control ledger lifecycle", () => {
  it("runs a realistic authorize → review → disposition → founder_review_ready → closed path", async () => {
    const store = new MemoryControlStore();
    const { tip: t0, digest } = await stageAndAuthorize(store);
    let tip = t0;

    const steps: Array<{
      type: Parameters<typeof appendControlEvent>[0]["eventType"];
      payload: Record<string, unknown>;
      at: string;
    }> = [
      {
        type: "implementation_started",
        payload: {
          session_or_run_id: "impl-1",
          provider: "cursor",
          pr_number: 12,
        },
        at: "2026-08-08T15:02:00.000Z",
      },
      {
        type: "implementation_declared",
        payload: buildImplementationDeclaredPayload({
          implementationSha: SAMPLE_SHA,
          prNumber: 12,
          sessionOrRunId: "impl-1",
        }),
        at: "2026-08-08T15:03:00.000Z",
      },
      {
        type: "validation_completed",
        payload: buildValidationCompletedPayload({
          outcome: "success",
          validatedSha: SAMPLE_SHA,
          evidenceRefs: [{ kind: "check_run", id: "1" }],
        }),
        at: "2026-08-08T15:04:00.000Z",
      },
      {
        type: "review_started",
        payload: buildReviewStartedPayload({
          targetSha: SAMPLE_SHA,
          sessionOrRunId: "rev-1",
          provider: "codex",
        }),
        at: "2026-08-08T15:05:00.000Z",
      },
      {
        type: "review_completed",
        payload: buildReviewCompletedPayload({
          reviewedSha: SAMPLE_SHA,
          status: "approved",
          sessionOrRunId: "rev-1",
          provider: "codex",
          evidenceRef: "r1",
        }),
        at: "2026-08-08T15:06:00.000Z",
      },
      {
        type: "finding_disposition",
        payload: {
          finding_id: "F2",
          disposition: "accepted_by_founder",
          founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        },
        at: "2026-08-08T15:07:00.000Z",
      },
      {
        type: "founder_review_ready",
        payload: buildFounderReviewReadyPayload({
          implementationSha: SAMPLE_SHA,
          validatedSha: SAMPLE_SHA,
          reviewedSha: SAMPLE_SHA,
          activeContractVersion: 1,
          activeContractDigest: digest,
          closureEvidenceRef: "closure-1",
          predicateResultId: "pred-1",
        }),
        at: "2026-08-08T15:08:00.000Z",
      },
      {
        type: "closed",
        payload: {
          merge_sha: SAMPLE_SHA,
          founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        },
        at: "2026-08-08T15:09:00.000Z",
      },
    ];

    for (const step of steps) {
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: step.type,
        payload: step.payload,
        occurredAt: step.at,
        actor: {
          kind: "orchestrator",
          provider: "test",
          session_or_run_id: "lifecycle",
          github_actor_id: null,
        },
        activeContractVersion: 1,
        activeContractDigest: digest,
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) throw new Error("append failed");
      tip = r.value.tip;
    }

    const recon = await reconstructTaskState(store, "AE-0001");
    expect(recon.ok).toBe(true);
    if (recon.ok) {
      expect(recon.value.state).toBe("CLOSED");
      expect(recon.value.implementationSha).toBe(SAMPLE_SHA);
      expect(recon.value.dispositions).toHaveLength(1);
      expect(recon.value.frozenContractPath).toBe(
        formatContractPath("AE-0001", 1),
      );
    }
  });

  it("CAS: first writer wins, second against stale tip fails", async () => {
    const store = new MemoryControlStore();
    const { tip, digest } = await stageAndAuthorize(store);

    const a = appendControlEvent({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      eventType: "implementation_started",
      payload: {
        session_or_run_id: "a",
        provider: "cursor",
      },
      occurredAt: "2026-08-08T16:00:00.000Z",
      actor: {
        kind: "orchestrator",
        provider: "test",
        session_or_run_id: "a",
        github_actor_id: null,
      },
      activeContractVersion: 1,
      activeContractDigest: digest,
    });
    const b = appendControlEvent({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      eventType: "implementation_started",
      payload: {
        session_or_run_id: "b",
        provider: "cursor",
      },
      occurredAt: "2026-08-08T16:00:01.000Z",
      actor: {
        kind: "orchestrator",
        provider: "test",
        session_or_run_id: "b",
        github_actor_id: null,
      },
      activeContractVersion: 1,
      activeContractDigest: digest,
    });

    const [ra, rb] = await Promise.all([a, b]);
    const oks = [ra.ok, rb.ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    expect(oks.filter((x) => !x)).toHaveLength(1);
    const failed = ra.ok ? rb : ra;
    if (!failed.ok) {
      expect(failed.issues.some((i) => i.code === "stale_tip")).toBe(true);
    }
  });

  it("rejects mutated / deleted prior protected objects", async () => {
    const store = new MemoryControlStore();
    await stageAndAuthorize(store);
    const snap = await store.getSnapshot();
    const next = cloneObjects(snap.objects);
    const eventPath = [...next.keys()].find((p) => p.includes("/000001-"))!;
    next.set(eventPath, "{}\n");
    const delta = verifyProtectedObjectDelta(
      contentDigestMap(snap.objects),
      contentDigestMap(next),
    );
    expect(delta.ok).toBe(false);
    if (!delta.ok) {
      expect(delta.issues.some((i) => i.code === "protected_modified")).toBe(
        true,
      );
    }

    const deleted = cloneObjects(snap.objects);
    deleted.delete(eventPath);
    const deltaDel = verifyProtectedObjectDelta(
      contentDigestMap(snap.objects),
      contentDigestMap(deleted),
    );
    expect(deltaDel.ok).toBe(false);
  });

  it("authorization binding negatives", async () => {
    const store = new MemoryControlStore();
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
    const tip = staged.value.tip;
    const body = authComment("AE-0001", 1, digest, SAMPLE_SHA);

    const wrongActor = await bindFounderAuthorization({
      store,
      expectedTip: tip,
      commentBody: body,
      observedFounderActorId: 1,
      commentAction: "created",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(wrongActor.ok).toBe(false);

    const edited = await bindFounderAuthorization({
      store,
      expectedTip: tip,
      commentBody: body,
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "edited",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(edited.ok).toBe(false);

    const wrongDigest = await bindFounderAuthorization({
      store,
      expectedTip: tip,
      commentBody: authComment("AE-0001", 1, "sha256:" + "f".repeat(64), SAMPLE_SHA),
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "created",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(wrongDigest.ok).toBe(false);

    const wrongBase = await bindFounderAuthorization({
      store,
      expectedTip: tip,
      commentBody: authComment("AE-0001", 1, digest, SAMPLE_SHA_B),
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "created",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(wrongBase.ok).toBe(false);
    if (!wrongBase.ok) {
      expect(wrongBase.issues.some((i) => i.code === "base_sha_mismatch")).toBe(
        true,
      );
    }

    const missing = await bindFounderAuthorization({
      store: new MemoryControlStore(),
      expectedTip: await new MemoryControlStore().getTip(),
      commentBody: body,
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "created",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(missing.ok).toBe(false);

    const ok = await bindFounderAuthorization({
      store,
      expectedTip: tip,
      commentBody: body,
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "created",
      issueNumber: 1,
      commentId: 1,
      createdAt: "2026-08-08T15:01:00.000Z",
    });
    expect(ok.ok).toBe(true);

    const dup = await bindFounderAuthorization({
      store,
      expectedTip: ok.ok ? ok.value.tip : tip,
      commentBody: body,
      observedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      commentAction: "created",
      issueNumber: 1,
      commentId: 2,
      createdAt: "2026-08-08T15:02:00.000Z",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.issues.some((i) => i.code === "duplicate_authorization")).toBe(
        true,
      );
    }
  });

  it("stale-review invalidation and reconstruction refuse malformed chain", async () => {
    const store = new MemoryControlStore();
    const { tip: t0, digest } = await stageAndAuthorize(store);
    let tip = t0;
    const ordered = [
      {
        type: "implementation_started" as const,
        payload: { session_or_run_id: "i", provider: "cursor", pr_number: 1 },
      },
      {
        type: "implementation_declared" as const,
        payload: buildImplementationDeclaredPayload({
          implementationSha: SAMPLE_SHA,
          prNumber: 1,
          sessionOrRunId: "i",
        }),
      },
      {
        type: "validation_completed" as const,
        payload: buildValidationCompletedPayload({
          outcome: "success",
          validatedSha: SAMPLE_SHA,
          evidenceRefs: [{ kind: "check_run", id: "1" }],
        }),
      },
      {
        type: "review_completed" as const,
        payload: buildReviewCompletedPayload({
          reviewedSha: SAMPLE_SHA,
          status: "approved",
          sessionOrRunId: "r",
          provider: "codex",
          evidenceRef: "e",
        }),
      },
      {
        type: "stale_review" as const,
        payload: buildStaleReviewPayload({
          priorReviewedSha: SAMPLE_SHA,
          currentHeadSha: SAMPLE_SHA_B,
        }),
      },
    ];
    for (const step of ordered) {
      const r = await appendControlEvent({
        store,
        expectedTip: tip,
        taskId: "AE-0001",
        eventType: step.type,
        payload: step.payload,
        occurredAt: "2026-08-08T17:00:00.000Z",
        actor: {
          kind: "orchestrator",
          provider: "test",
          session_or_run_id: "s",
          github_actor_id: null,
        },
        activeContractVersion: 1,
        activeContractDigest: digest,
      });
      expect(r.ok).toBe(true);
      if (r.ok) tip = r.value.tip;
    }
    const recon = await reconstructTaskState(store, "AE-0001");
    expect(recon.ok).toBe(true);
    if (recon.ok) {
      expect(recon.value.state).toBe("VALIDATING");
      expect(recon.value.reviewStatus).toBe("stale");
    }

    // Corrupt chain → reconstruct refuses
    const snap = await store.getSnapshot();
    const broken = cloneObjects(snap.objects);
    const p = [...broken.keys()].find((x) => x.includes("000002-"))!;
    broken.set(p, '{"nope":true}\n');
    const badStore = new MemoryControlStore(broken);
    const bad = await reconstructTaskState(badStore, "AE-0001");
    expect(bad.ok).toBe(false);
  });

  it("CLI happy path and non-zero exits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ae-b-cli-"));
    const { yaml, digest } = digestTaskContract(sampleContract());
    const contractFile = path.join(dir, "contract.yaml");
    const commentFile = path.join(dir, "authorize.txt");
    await writeFile(contractFile, yaml, "utf8");
    await writeFile(
      commentFile,
      authComment("AE-0001", 1, digest, SAMPLE_SHA),
      "utf8",
    );
    const ledger = path.join(dir, "ledger");

    const invalid = await runAeDryRunCli([
      "validate-contract",
      "--file",
      commentFile,
      "--json",
    ]);
    expect(invalid.exitCode).not.toBe(0);

    const validate = await runAeDryRunCli([
      "validate-contract",
      "--file",
      contractFile,
      "--json",
    ]);
    expect(validate.exitCode).toBe(0);

    const stage = await runAeDryRunCli([
      "stage-contract",
      "--ledger",
      ledger,
      "--file",
      contractFile,
      "--task",
      "AE-0001",
      "--version",
      "1",
      "--json",
    ]);
    expect(stage.exitCode).toBe(0);

    const badAuth = await runAeDryRunCli([
      "authorize",
      "--ledger",
      ledger,
      "--comment-file",
      commentFile,
      "--actor",
      "1",
      "--issue",
      "1",
      "--comment-id",
      "1",
      "--created-at",
      "2026-08-08T15:01:00.000Z",
      "--json",
    ]);
    expect(badAuth.exitCode).not.toBe(0);

    const auth = await runAeDryRunCli([
      "authorize",
      "--ledger",
      ledger,
      "--comment-file",
      commentFile,
      "--actor",
      String(CONFIGURED_FOUNDER_GITHUB_ACTOR_ID),
      "--issue",
      "1",
      "--comment-id",
      "1",
      "--created-at",
      "2026-08-08T15:01:00.000Z",
      "--json",
    ]);
    expect(auth.exitCode).toBe(0);

    const verify = await runAeDryRunCli([
      "verify-chain",
      "--ledger",
      ledger,
      "--task",
      "AE-0001",
      "--json",
    ]);
    expect(verify.exitCode).toBe(0);

    // Break chain on disk
    const fsStore = new FilesystemControlStore(ledger);
    const snap = await fsStore.getSnapshot();
    const next = cloneObjects(snap.objects);
    const ep = [...next.keys()].find((p) => p.includes("events/"))!;
    next.set(ep, "{}\n");
    await fsStore.compareAndSwap(snap.tip, next);
    const verifyBad = await runAeDryRunCli([
      "verify-chain",
      "--ledger",
      ledger,
      "--task",
      "AE-0001",
      "--json",
    ]);
    expect(verifyBad.exitCode).not.toBe(0);
  });

  it("rejects overwrite of existing frozen contract with different bytes", async () => {
    const store = new MemoryControlStore();
    const { yaml, digest } = digestTaskContract(sampleContract());
    await stageAndAuthorize(store);
    const other = digestTaskContract(sampleContract({ title: "Other" }));
    const tip = await store.getTip();
    const again = await stageContract({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      contractVersion: 1,
      contractYaml: other.yaml,
      occurredAt: "2026-08-08T18:00:00.000Z",
    });
    expect(again.ok).toBe(false);
    void digest;
    void yaml;
  });

  it("rejects append with wrong active contract digest", async () => {
    const store = new MemoryControlStore();
    const { tip, digest } = await stageAndAuthorize(store);
    void digest;
    const r = await appendControlEvent({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      eventType: "implementation_started",
      payload: { session_or_run_id: "x", provider: "cursor" },
      occurredAt: "2026-08-08T18:00:00.000Z",
      actor: {
        kind: "orchestrator",
        provider: "t",
        session_or_run_id: "x",
        github_actor_id: null,
      },
      activeContractVersion: 1,
      activeContractDigest: "sha256:" + "a".repeat(64),
    });
    expect(r.ok).toBe(false);
  });

  it("SHA pin helpers reject short SHAs and equal stale heads", () => {
    expect(() =>
      buildImplementationDeclaredPayload({
        implementationSha: "abc",
        prNumber: 1,
        sessionOrRunId: "s",
      }),
    ).toThrow(/40-char/);
    expect(() =>
      buildStaleReviewPayload({
        priorReviewedSha: SAMPLE_SHA,
        currentHeadSha: SAMPLE_SHA,
      }),
    ).toThrow(/distinct/);
  });
});
