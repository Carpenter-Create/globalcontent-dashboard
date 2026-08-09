import { describe, expect, it } from "vitest";

import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestTaskContract } from "./contract-digest";
import { bootstrapControlBranch } from "./control-bootstrap";
import { runAeControlCli } from "./control-cli";
import { readControlBranch } from "./control-github-read";
import { openGitHubControlStore } from "./control-github-store";
import { compareAndSwapControlBranch } from "./control-github-write";
import { stageContract } from "./control-ledger";
import { FakeGitHubTransport } from "./fake-github";
import { loadAgenticGitHubConfig } from "./github-config";
import { redactSecrets } from "./github-credentials";
import { GitHubRestClient } from "./github-rest";
import {
  liveAuthorizeAndFreeze,
  verifyLiveFounderAuthorization,
} from "./live-founder-authorization";
import { ingestPrEvidence } from "./pr-evidence";
import { runProtectionPreflight } from "./protection-preflight";
import { sampleContract, SAMPLE_SHA } from "./test-fixtures";

const OWNER = "Carpenter-Create";
const REPO = "globalcontent-dashboard";
const TS = "2026-08-08T20:00:00.000Z";

function cfg() {
  const r = loadAgenticGitHubConfig({ owner: OWNER, repo: REPO });
  if (!r.ok) throw new Error(r.message);
  return r.config;
}

function client(fake: FakeGitHubTransport) {
  return new GitHubRestClient(cfg(), fake);
}

function authBody(
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

async function bootstrap(fake: FakeGitHubTransport) {
  const c = client(fake);
  const result = await bootstrapControlBranch({
    client: c,
    config: cfg(),
    apply: true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return c;
}

describe("Phase C founder authorization (live verify)", () => {
  it("accepts valid created comment from founder 40549435", async () => {
    const { yaml, digest } = digestTaskContract(sampleContract());
    void yaml;
    const fake = new FakeGitHubTransport();
    fake.setIssueComment({
      id: 501,
      issue_number: 42,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: TS,
      user: { id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID, login: "founder" },
    });
    const verified = await verifyLiveFounderAuthorization(client(fake), cfg(), {
      issueNumber: 42,
      commentId: 501,
      expectedTaskId: "AE-0001",
      expectedContractVersion: 1,
      expectedContractDigest: digest,
      expectedBaseSha: SAMPLE_SHA,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.actorId).toBe(CONFIGURED_FOUNDER_GITHUB_ACTOR_ID);
      expect(verified.value.commentAction).toBe("created");
    }
  });

  it("rejects wrong actor", async () => {
    const { digest } = digestTaskContract(sampleContract());
    const fake = new FakeGitHubTransport();
    fake.setIssueComment({
      id: 501,
      issue_number: 42,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: TS,
      user: { id: 999, login: "not-founder" },
    });
    const verified = await verifyLiveFounderAuthorization(client(fake), cfg(), {
      issueNumber: 42,
      commentId: 501,
      expectedTaskId: "AE-0001",
      expectedContractVersion: 1,
      expectedContractDigest: digest,
      expectedBaseSha: SAMPLE_SHA,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.code).toBe("wrong_actor");
  });

  it("rejects edited comment", async () => {
    const { digest } = digestTaskContract(sampleContract());
    const fake = new FakeGitHubTransport();
    fake.setIssueComment({
      id: 501,
      issue_number: 42,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: "2026-08-08T21:00:00.000Z",
      user: { id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID, login: "founder" },
    });
    const verified = await verifyLiveFounderAuthorization(client(fake), cfg(), {
      issueNumber: 42,
      commentId: 501,
      expectedTaskId: "AE-0001",
      expectedContractVersion: 1,
      expectedContractDigest: digest,
      expectedBaseSha: SAMPLE_SHA,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.code).toBe("edited_comment");
  });

  it("rejects wrong digest / version / base SHA / issue / missing", async () => {
    const { digest } = digestTaskContract(sampleContract());
    const fake = new FakeGitHubTransport();
    fake.setIssueComment({
      id: 501,
      issue_number: 42,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: TS,
      user: { id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID, login: "founder" },
    });
    const c = client(fake);
    const base = {
      issueNumber: 42,
      commentId: 501,
      expectedTaskId: "AE-0001",
      expectedContractVersion: 1,
      expectedContractDigest: digest,
      expectedBaseSha: SAMPLE_SHA,
    };
    expect(
      (
        await verifyLiveFounderAuthorization(c, cfg(), {
          ...base,
          expectedContractDigest: "sha256:" + "e".repeat(64),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyLiveFounderAuthorization(c, cfg(), {
          ...base,
          expectedContractVersion: 2,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyLiveFounderAuthorization(c, cfg(), {
          ...base,
          expectedBaseSha: "f".repeat(40),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyLiveFounderAuthorization(c, cfg(), {
          ...base,
          issueNumber: 99,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyLiveFounderAuthorization(c, cfg(), {
          ...base,
          commentId: 404,
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects wrong repository", async () => {
    const { digest } = digestTaskContract(sampleContract());
    const fake = new FakeGitHubTransport("Other", "repo");
    fake.setIssueComment({
      id: 1,
      issue_number: 1,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: TS,
      user: { id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID, login: "founder" },
    });
    // Client configured for Carpenter-Create/globalcontent-dashboard but fake is Other/repo
    const verified = await verifyLiveFounderAuthorization(
      new GitHubRestClient(cfg(), fake),
      cfg(),
      {
        issueNumber: 1,
        commentId: 1,
        expectedTaskId: "AE-0001",
        expectedContractVersion: 1,
        expectedContractDigest: digest,
        expectedBaseSha: SAMPLE_SHA,
      },
    );
    expect(verified.ok).toBe(false);
  });
});

describe("Phase C control reads / CAS writes", () => {
  it("reads valid bootstrap control tree", async () => {
    const fake = new FakeGitHubTransport();
    const c = await bootstrap(fake);
    const read = await readControlBranch(c, cfg());
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.objects.size).toBe(0);
      expect(read.value.metadata.has("CONTROL_PLANE.md")).toBe(true);
    }
  });

  it("rejects unknown path on control tree", async () => {
    const fake = new FakeGitHubTransport();
    const c = await bootstrap(fake);
    const tipRes = await c.getBranchTip("ae/control");
    expect(tipRes.ok).toBe(true);
    if (!tipRes.ok) throw new Error(tipRes.message);
    const tip = tipRes.data;
    const prior = await readControlBranch(c, cfg());
    expect(prior.ok).toBe(true);
    if (!prior.ok) throw new Error(prior.message);

    // Inject unknown path by mutating fake tree via a CAS-like direct blob/tree/commit
    const blob = await c.createBlob("evil");
    expect(blob.ok).toBe(true);
    if (!blob.ok) throw new Error(blob.message);
    const entries = [
      ...[...prior.value.metadata.entries()].map(([path]) => ({
        path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: prior.value.blobShas.get(path)!,
      })),
      {
        path: "secrets/token.txt",
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data,
      },
    ];
    const tree = await c.createTree(entries);
    expect(tree.ok).toBe(true);
    if (!tree.ok) throw new Error(tree.message);
    const commit = await c.createCommit({
      message: "evil",
      treeSha: tree.data,
      parentShas: [tip],
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) throw new Error(commit.message);
    const upd = await c.updateRef("ae/control", commit.data, tip);
    expect(upd.ok).toBe(true);

    const read = await readControlBranch(c, cfg());
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe("unknown_path");
  });

  it("CAS succeeds on expected tip and fails when tip moved", async () => {
    const fake = new FakeGitHubTransport();
    const c = await bootstrap(fake);
    const tip1Res = await c.getBranchTip("ae/control");
    expect(tip1Res.ok).toBe(true);
    if (!tip1Res.ok) throw new Error(tip1Res.message);
    const tip1 = tip1Res.data;
    const read = await readControlBranch(c, cfg());
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);

    const { yaml } = digestTaskContract(sampleContract());
    const next = new Map(read.value.objects);
    next.set("proposed/AE-0001/v1.yaml", yaml);

    const ok = await compareAndSwapControlBranch({
      client: c,
      config: cfg(),
      expectedTip: tip1,
      nextObjects: next,
      commitMessage: "ae: stage proposed",
    });
    expect(ok.ok).toBe(true);

    const stale = await compareAndSwapControlBranch({
      client: c,
      config: cfg(),
      expectedTip: tip1,
      nextObjects: next,
      commitMessage: "ae: stale",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("stale_tip");
  });

  it("rejects modify/delete of old protected event/contract", async () => {
    const fake = new FakeGitHubTransport();
    const c = await bootstrap(fake);
    const store = openGitHubControlStore(c, cfg());
    const { yaml, digest } = digestTaskContract(sampleContract());
    void digest;
    let tip = await store.getTip();
    const staged = await stageContract({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      contractVersion: 1,
      contractYaml: yaml,
      occurredAt: TS,
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error("stage failed");
    tip = staged.value.tip;

    const snap = await store.getSnapshot();
    const modified = new Map(snap.objects);
    const eventPath = [...modified.keys()].find((p) => p.startsWith("events/"));
    expect(eventPath).toBeTruthy();
    modified.set(eventPath!, '{"tampered":true}');

    const modCas = await compareAndSwapControlBranch({
      client: c,
      config: cfg(),
      expectedTip: tip,
      nextObjects: modified,
      commitMessage: "ae: tamper event",
    });
    expect(modCas.ok).toBe(false);

    const deleted = new Map(snap.objects);
    deleted.delete(eventPath!);
    const delCas = await compareAndSwapControlBranch({
      client: c,
      config: cfg(),
      expectedTip: tip,
      nextObjects: deleted,
      commitMessage: "ae: delete event",
    });
    expect(delCas.ok).toBe(false);

    // Force update impossible via client API
    const force = await fake.request({
      method: "PATCH",
      path: `/repos/${OWNER}/${REPO}/git/refs/heads/ae%2Fcontrol`,
      body: { sha: tip, force: true },
    });
    expect(force.ok).toBe(false);
  });

  it("live authorize+freeze on ae/control", async () => {
    const fake = new FakeGitHubTransport();
    const c = await bootstrap(fake);
    const store = openGitHubControlStore(c, cfg());
    const { yaml, digest } = digestTaskContract(sampleContract());
    let tip = await store.getTip();
    const staged = await stageContract({
      store,
      expectedTip: tip,
      taskId: "AE-0001",
      contractVersion: 1,
      contractYaml: yaml,
      occurredAt: TS,
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error("stage failed");
    tip = staged.value.tip;

    fake.setIssueComment({
      id: 900,
      issue_number: 10,
      body: authBody("AE-0001", 1, digest, SAMPLE_SHA),
      created_at: TS,
      updated_at: TS,
      user: { id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID, login: "founder" },
    });

    const auth = await liveAuthorizeAndFreeze({
      client: c,
      config: cfg(),
      store,
      expectedTip: tip,
      expectations: {
        issueNumber: 10,
        commentId: 900,
        expectedTaskId: "AE-0001",
        expectedContractVersion: 1,
        expectedContractDigest: digest,
        expectedBaseSha: SAMPLE_SHA,
      },
    });
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.value.contractPath).toBe("contracts/AE-0001/v1.yaml");
    }
  });
});

describe("Phase C evidence ingestion", () => {
  it("maps head SHA, checks, and review freshness", async () => {
    const fake = new FakeGitHubTransport();
    const head = "1".repeat(40);
    const stale = "2".repeat(40);
    fake.setPull({
      number: 7,
      state: "open",
      head: { sha: head, ref: "feat/x" },
      base: { sha: SAMPLE_SHA, ref: "main" },
    });
    fake.setCheckRuns(head, [
      {
        id: 11,
        name: "typecheck",
        head_sha: head,
        status: "completed",
        conclusion: "success",
        started_at: TS,
        completed_at: TS,
        app: { id: 1, slug: "github-actions", name: "GitHub Actions" },
      },
      {
        id: 12,
        name: "typecheck",
        head_sha: head,
        status: "completed",
        conclusion: "success",
        started_at: TS,
        completed_at: TS,
        app: { id: 99, slug: "spoof", name: "Spoof" },
      },
      {
        id: 13,
        name: "test",
        head_sha: head,
        status: "in_progress",
        conclusion: null,
        app: { id: 1, slug: "github-actions", name: "GitHub Actions" },
      },
      {
        id: 14,
        name: "build",
        head_sha: head,
        status: "completed",
        conclusion: "failure",
        app: { id: 1, slug: "github-actions", name: "GitHub Actions" },
      },
    ]);
    fake.setReviews(7, [
      {
        id: 1,
        state: "APPROVED",
        commit_id: stale,
        submitted_at: TS,
        user: { id: 5, login: "reviewer" },
      },
      {
        id: 2,
        state: "APPROVED",
        commit_id: head,
        submitted_at: TS,
        user: { id: 5, login: "reviewer" },
      },
    ]);

    const evidence = await ingestPrEvidence(client(fake), 7);
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.message);
    expect(evidence.value.headSha).toBe(head);
    expect(evidence.value.duplicateCheckNames).toContain("typecheck");
    expect(evidence.value.reviews.find((r) => r.reviewId === 1)?.freshAgainstHead).toBe(
      false,
    );
    expect(evidence.value.reviews.find((r) => r.reviewId === 2)?.freshAgainstHead).toBe(
      true,
    );
    expect(
      evidence.value.observedChecks.find((c) => c.name === "test")?.conclusion,
    ).toBe("in_progress");
    expect(
      evidence.value.observedChecks.find((c) => c.name === "build")?.conclusion,
    ).toBe("failure");
  });
});

describe("Phase C CLI", () => {
  it("defaults mutating commands to dry-run and requires --apply", async () => {
    const fake = new FakeGitHubTransport();
    const dry = await runAeControlCli(
      ["control-bootstrap", "--owner", OWNER, "--repo", REPO, "--json"],
      { transport: fake },
    );
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain('"dryRun": true');
    expect(fake.getRef("refs/heads/ae/control")).toBeUndefined();

    const apply = await runAeControlCli(
      [
        "control-bootstrap",
        "--owner",
        OWNER,
        "--repo",
        REPO,
        "--apply",
        "--json",
      ],
      { transport: fake },
    );
    expect(apply.exitCode).toBe(0);
    expect(fake.getRef("refs/heads/ae/control")).toBeTruthy();
  });

  it("rejects wrong repository and never prints secrets", async () => {
    const fake = new FakeGitHubTransport();
    const wrong = await runAeControlCli(
      ["github-read", "--owner", "Wrong", "--repo", REPO, "--json"],
      { transport: fake },
    );
    expect(wrong.exitCode).toBe(1);

    const token = "ghp_SECRETtokenVALUE1234567890";
    expect(redactSecrets(`Bearer ${token}`, token)).not.toContain("SECRET");
    expect(redactSecrets(token)).toContain("[REDACTED]");
  });

  it("stale-tip apply is rejected", async () => {
    const fake = new FakeGitHubTransport();
    await bootstrap(fake);
    const tip = fake.getRef("refs/heads/ae/control")!;
    // Move tip out from under a concurrent writer
    const c = client(fake);
    const blob = await c.createBlob("x");
    if (!blob.ok) throw new Error(blob.message);
    const tree = await c.createTree([
      {
        path: "CONTROL_PLANE.md",
        mode: "100644",
        type: "blob",
        sha: blob.data,
      },
    ]);
    if (!tree.ok) throw new Error(tree.message);
    const commit = await c.createCommit({
      message: "move",
      treeSha: tree.data,
      parentShas: [tip],
    });
    if (!commit.ok) throw new Error(commit.message);
    await c.updateRef("ae/control", commit.data, tip);

    const cas = await compareAndSwapControlBranch({
      client: c,
      config: cfg(),
      expectedTip: tip,
      nextObjects: new Map(),
      commitMessage: "stale",
    });
    expect(cas.ok).toBe(false);
    if (!cas.ok) expect(cas.code).toBe("stale_tip");
  });
});

describe("Phase C protection preflight", () => {
  it("reports UNKNOWN when rulesets inaccessible", async () => {
    const fake = new FakeGitHubTransport();
    await bootstrap(fake);
    fake.setRulesets("forbidden");
    const report = await runProtectionPreflight(client(fake), cfg());
    expect(report.branchExists).toBe("YES");
    expect(report.rulesetsReadable).toBe("UNKNOWN");
    expect(report.writesSafeToClaim).toBe(false);
  });
});
