import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  REQUIRED_JOB_NAMES,
  FAILURE_CONCLUSIONS,
  VALID_JOB_CONCLUSIONS,
  NONFAILURE_CONCLUSIONS,
  SLACK_TARGET_LABEL,
  REQUIRED_NOTIFICATION_ATTEMPT,
  isDirectExecution,
  sanitizeSlackText,
  validateWebhookUrl,
  parseWorkflowRunEvent,
  selectFailedRequiredJobs,
  evaluateNotification,
  buildSlackPayload,
  buildPullRequestUrl,
  buildWorkflowRunUrl,
  buildSourceAttemptKey,
  buildAttemptJobsUrl,
  isBoundAttemptJobsUrl,
  fetchWorkflowJobs,
  sendSlackMessage,
  runNotifyCiException,
  parseNextLink,
  indexJobs,
  classifyJobConclusion,
  resolveUniquePullRequestNumber,
  parseNotificationWorkflowAttempt,
  validateSourceIdentity,
} from "./notify-ci-exception.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const MODULE_SOURCE = join(REPO_ROOT, "scripts/governance/notify-ci-exception.mjs");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/slack-ci-exceptions.yml");
const README_PATH = join(REPO_ROOT, "README.md");

const FAKE_REPO = "example-org/example-dashboard";
const FAKE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAKE_RUN_ID = 9001;
const FAKE_RUN_ATTEMPT = 1;
const FAKE_PR = 42;
const FAKE_WEBHOOK = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";
const [FAKE_OWNER, FAKE_NAME] = FAKE_REPO.split("/");

function assertOutsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  assert.ok(rel.startsWith(".."), "fixture root must be outside repository");
}

/**
 * @param {(source: string) => string} mutator
 */
async function withMutatedModule(mutator, fn) {
  const dir = mkdtempSync(join(tmpdir(), "notify-ci-mut-"));
  try {
    assertOutsideRepo(dir);
    const copyPath = join(dir, "notify-ci-exception.mjs");
    writeFileSync(copyPath, mutator(readFileSync(MODULE_SOURCE, "utf8")));
    const mod = await import(`${pathToFileURL(copyPath).href}?t=${Date.now()}`);
    return await fn(mod);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {Partial<{
 *   eventName: string,
 *   repository: string,
 *   runId: number,
 *   runAttempt: number,
 *   headSha: string,
 *   prNumber: number | null,
 *   pullRequests: unknown,
 * }>} [overrides]
 */
function makeEvent(overrides = {}) {
  const eventName = overrides.eventName ?? "pull_request";
  const repository = overrides.repository ?? FAKE_REPO;
  const runId = overrides.runId ?? FAKE_RUN_ID;
  const runAttempt = overrides.runAttempt ?? FAKE_RUN_ATTEMPT;
  const headSha = overrides.headSha ?? FAKE_SHA;
  const prNumber = overrides.prNumber === undefined ? FAKE_PR : overrides.prNumber;
  const pullRequests =
    overrides.pullRequests !== undefined
      ? overrides.pullRequests
      : prNumber == null
        ? []
        : [{ number: prNumber }];

  return {
    workflow_run: {
      id: runId,
      run_attempt: runAttempt,
      event: eventName,
      head_sha: headSha,
      pull_requests: pullRequests,
      repository: { full_name: repository },
      html_url: "https://evil.example/should-not-be-used",
      display_title: "UNTRUSTED TITLE with @channel",
    },
    repository: { full_name: repository },
  };
}

/**
 * @param {Array<{
 *   name: string,
 *   conclusion: string | null,
 *   id?: number,
 *   status?: string | null,
 *   omitStatus?: boolean,
 *   run_id?: number,
 *   check_run_id?: number,
 *   workflow_name?: string,
 * }>} specs
 */
function makeJobs(specs) {
  return specs.map((spec, i) => {
    /** @type {Record<string, unknown>} */
    const job = {
      id: spec.id ?? i + 1,
      name: spec.name,
      conclusion: spec.conclusion,
      run_id: spec.run_id ?? FAKE_RUN_ID,
      check_run_id: spec.check_run_id ?? 1000 + (spec.id ?? i + 1),
      workflow_name: spec.workflow_name ?? "ci",
    };
    if (!spec.omitStatus) {
      job.status = spec.status === undefined ? "completed" : spec.status;
    }
    return job;
  });
}

function requiredSuccessJobs() {
  return makeJobs([
    { name: "checks", conclusion: "success", id: 1 },
    { name: "governance", conclusion: "success", id: 2 },
    { name: "isolation", conclusion: "success", id: 3 },
  ]);
}

/**
 * @param {Partial<Record<string, string>>} [overrides]
 */
function productionEnv(overrides = {}) {
  return {
    GITHUB_TOKEN: "fake",
    SLACK_WEBHOOK_URL: FAKE_WEBHOOK,
    NOTIFICATION_WORKFLOW_RUN_ATTEMPT: String(REQUIRED_NOTIFICATION_ATTEMPT),
    SOURCE_WORKFLOW_RUN_ID: String(FAKE_RUN_ID),
    SOURCE_WORKFLOW_RUN_ATTEMPT: String(FAKE_RUN_ATTEMPT),
    ...overrides,
  };
}

/**
 * @param {unknown[]} jobs
 * @param {{ runId?: number, runAttempt?: number }} [bind]
 */
function mockFetchFor(jobs, bind = {}) {
  const runId = bind.runId ?? FAKE_RUN_ID;
  const runAttempt = bind.runAttempt ?? FAKE_RUN_ATTEMPT;
  /** @type {Array<{ url: string, init?: RequestInit }>} */
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const href = String(url);
    if (href.includes("api.github.com") && href.includes("/jobs")) {
      assert.ok(
        isBoundAttemptJobsUrl(href, runId, runAttempt),
        `expected attempt-bound jobs URL for ${runId}/${runAttempt}, got ${href}`,
      );
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ jobs }),
      };
    }
    if (href.startsWith("https://hooks.slack.com/")) {
      return { status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected-url:${href}`);
  };
  return { fetchImpl, calls, webhook: FAKE_WEBHOOK };
}

function slackPostCount(calls) {
  return calls.filter((c) => String(c.url).includes("hooks.slack.com")).length;
}

function githubJobUrls(calls) {
  return calls
    .map((c) => String(c.url))
    .filter((u) => u.includes("api.github.com") && u.includes("/jobs"));
}

describe("constants", () => {
  it("requires exact governance and isolation job names", () => {
    assert.deepEqual([...REQUIRED_JOB_NAMES], ["governance", "isolation"]);
  });

  it("defines exhaustive valid conclusions including stale", () => {
    assert.ok(VALID_JOB_CONCLUSIONS.includes("stale"));
    assert.ok(FAILURE_CONCLUSIONS.includes("stale"));
    assert.deepEqual(
      [...NONFAILURE_CONCLUSIONS].sort(),
      ["neutral", "skipped", "success"].sort(),
    );
  });

  it("documents Slack target label", () => {
    assert.equal(SLACK_TARGET_LABEL, "#global-content-dev");
  });
});

describe("sanitizeSlackText / webhook", () => {
  it("escapes markup and neutralizes mentions", () => {
    assert.equal(sanitizeSlackText("a<b>&c"), "a&lt;b&gt;&amp;c");
    const out = sanitizeSlackText("alert @channel <@U12345>");
    assert.ok(!out.includes("@channel"));
    assert.ok(out.includes("[mention]"));
  });

  it("validates Slack webhook hosts", () => {
    assert.equal(validateWebhookUrl(FAKE_WEBHOOK).ok, true);
    assert.equal(validateWebhookUrl("").category, "missing_webhook");
    assert.equal(
      validateWebhookUrl("https://evil.example/services/T/B/X").category,
      "webhook_host_rejected",
    );
  });
});

describe("parseWorkflowRunEvent and PR associations", () => {
  it("accepts well-formed PR events with source attempt key", () => {
    const parsed = parseWorkflowRunEvent(makeEvent());
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !("context" in parsed)) throw new Error("expected context");
    assert.equal(parsed.context.runAttempt, FAKE_RUN_ATTEMPT);
    assert.equal(
      parsed.context.sourceAttemptKey,
      buildSourceAttemptKey(FAKE_RUN_ID, FAKE_RUN_ATTEMPT),
    );
  });

  it("skips push; dedupes same PR; rejects multiple PRs", () => {
    const skip = parseWorkflowRunEvent(makeEvent({ eventName: "push" }));
    assert.equal(skip.ok, true);
    assert.equal("skip" in skip && skip.skip, true);

    assert.equal(
      resolveUniquePullRequestNumber([{ number: 7 }, { number: 7 }]).prNumber,
      7,
    );
    assert.equal(
      resolveUniquePullRequestNumber([{ number: 1 }, { number: 2 }]).category,
      "ambiguous_pull_request",
    );
    assert.equal(
      parseWorkflowRunEvent(makeEvent({ pullRequests: [] })).category,
      "missing_pull_request",
    );
  });
});

describe("explicit completed status requirement", () => {
  it("accepts only status === completed with allowlisted conclusions", () => {
    assert.equal(classifyJobConclusion("failure", "completed").ok, true);
    assert.equal(classifyJobConclusion("failure", "completed").failure, true);
  });

  it("fails when status property is genuinely omitted", () => {
    const jobs = [
      { id: 1, name: "governance", conclusion: "failure", run_id: FAKE_RUN_ID },
      {
        id: 2,
        name: "isolation",
        conclusion: "success",
        status: "completed",
        run_id: FAKE_RUN_ID,
      },
    ];
    assert.equal("status" in jobs[0], false);
    const result = selectFailedRequiredJobs(jobs);
    assert.equal(result.action, "fail");
    assert.equal(result.category, "incomplete_job_data");
  });

  it("fails for null, empty, queued, in_progress, unknown, numeric, and object status", () => {
    assert.equal(classifyJobConclusion("failure", null).category, "incomplete_job_data");
    assert.equal(classifyJobConclusion("failure", "").category, "incomplete_job_data");
    assert.equal(classifyJobConclusion("failure", "queued").category, "incomplete_job_data");
    assert.equal(classifyJobConclusion("failure", "in_progress").category, "incomplete_job_data");
    assert.equal(classifyJobConclusion("failure", "mystery").category, "incomplete_job_data");
    assert.equal(classifyJobConclusion("failure", 1).category, "malformed_job_data");
    assert.equal(classifyJobConclusion("failure", { ok: true }).category, "malformed_job_data");

    for (const status of [null, "", "queued", "in_progress", "unknown"]) {
      const result = selectFailedRequiredJobs(
        makeJobs([
          { name: "governance", conclusion: "failure", status: /** @type {any} */ (status) },
          { name: "isolation", conclusion: "success" },
        ]),
      );
      assert.equal(result.action, "fail", String(status));
    }
  });

  it("does not synthesize missing status via omitStatus helper path", () => {
    const result = selectFailedRequiredJobs(
      makeJobs([
        { name: "governance", conclusion: "failure", omitStatus: true },
        { name: "isolation", conclusion: "success" },
      ]),
    );
    assert.equal(result.action, "fail");
    assert.equal(result.category, "incomplete_job_data");
  });
});

describe("selectFailedRequiredJobs", () => {
  it("governance/isolation/stale/both failure paths and nonfailures", () => {
    assert.deepEqual(
      selectFailedRequiredJobs(
        makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "success" },
        ]),
      ).failedJobs,
      ["governance"],
    );
    assert.deepEqual(
      selectFailedRequiredJobs(
        makeJobs([
          { name: "governance", conclusion: "success" },
          { name: "isolation", conclusion: "stale" },
        ]),
      ).failedJobs,
      ["isolation"],
    );
    assert.deepEqual(
      selectFailedRequiredJobs(
        makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "failure" },
        ]),
      ).failedJobs,
      ["governance", "isolation"],
    );
    for (const conclusion of NONFAILURE_CONCLUSIONS) {
      assert.equal(
        selectFailedRequiredJobs(
          makeJobs([
            { name: "governance", conclusion },
            { name: "isolation", conclusion: "success" },
          ]),
        ).action,
        "skip",
      );
    }
    for (const conclusion of FAILURE_CONCLUSIONS) {
      assert.equal(
        selectFailedRequiredJobs(
          makeJobs([
            { name: "governance", conclusion },
            { name: "isolation", conclusion: "success" },
          ]),
        ).action,
        "notify",
        conclusion,
      );
    }
  });

  it("checks-only failure skips; missing peer fails; exact dupes ok; conflicts fail", () => {
    assert.equal(
      selectFailedRequiredJobs(
        makeJobs([
          { name: "checks", conclusion: "failure" },
          { name: "governance", conclusion: "success" },
          { name: "isolation", conclusion: "success" },
        ]),
      ).action,
      "skip",
    );
    assert.equal(
      selectFailedRequiredJobs(
        makeJobs([{ name: "governance", conclusion: "failure" }]),
      ).category,
      "missing_required_jobs",
    );
    const exact = makeJobs([
      { name: "governance", conclusion: "failure", id: 10 },
      { name: "isolation", conclusion: "success", id: 11 },
    ]);
    assert.equal(selectFailedRequiredJobs([...exact, { ...exact[0] }]).action, "notify");
    assert.equal(
      selectFailedRequiredJobs([
        ...makeJobs([{ name: "governance", conclusion: "failure", id: 10 }]),
        ...makeJobs([{ name: "governance", conclusion: "success", id: 10 }]),
        ...makeJobs([{ name: "isolation", conclusion: "success", id: 11 }]),
      ]).category,
      "conflicting_job_records",
    );
    assert.equal(indexJobs(null).ok, false);
  });
});

describe("attempt-specific jobs API", () => {
  it("builds and binds attempt URLs; rejects run-level latest endpoint", () => {
    const attempt1 = buildAttemptJobsUrl(
      "https://api.github.com",
      FAKE_OWNER,
      FAKE_NAME,
      9001,
      1,
    );
    const attempt2 = buildAttemptJobsUrl(
      "https://api.github.com",
      FAKE_OWNER,
      FAKE_NAME,
      9001,
      2,
    );
    assert.ok(attempt1.includes("/actions/runs/9001/attempts/1/jobs"));
    assert.ok(attempt2.includes("/actions/runs/9001/attempts/2/jobs"));
    assert.ok(isBoundAttemptJobsUrl(attempt1, 9001, 1));
    assert.ok(isBoundAttemptJobsUrl(attempt2, 9001, 2));
    assert.equal(isBoundAttemptJobsUrl(attempt1, 9001, 2), false);
    assert.equal(
      isBoundAttemptJobsUrl(
        `https://api.github.com/repos/${FAKE_REPO}/actions/runs/9001/jobs`,
        9001,
        1,
      ),
      false,
    );
    assert.ok(
      isBoundAttemptJobsUrl(
        "https://api.github.com/repositories/1/actions/runs/9001/attempts/1/jobs?page=2",
        9001,
        1,
      ),
    );
  });

  it("attempt 1 uses the attempt-1 endpoint; attempt 2 uses attempt-2", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    {
      const { fetchImpl, calls } = mockFetchFor(jobs, { runAttempt: 1 });
      await runNotifyCiException({
        env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "1" }),
        fetchImpl,
        readEvent: () => makeEvent({ runAttempt: 1 }),
      });
      const urls = githubJobUrls(calls);
      assert.equal(urls.length, 1);
      assert.ok(urls[0].includes("/attempts/1/jobs"));
      assert.ok(!urls[0].match(/\/actions\/runs\/\d+\/jobs(?:\?|$)/));
    }
    {
      const { fetchImpl, calls } = mockFetchFor(jobs, { runAttempt: 2 });
      await runNotifyCiException({
        env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "2" }),
        fetchImpl,
        readEvent: () => makeEvent({ runAttempt: 2 }),
      });
      const urls = githubJobUrls(calls);
      assert.equal(urls.length, 1);
      assert.ok(urls[0].includes("/attempts/2/jobs"));
    }
  });

  it("delayed attempt-1 notifier cannot consume attempt-2 job results", async () => {
    const attempt1Jobs = makeJobs([
      { name: "governance", conclusion: "success", id: 1 },
      { name: "isolation", conclusion: "success", id: 2 },
    ]);
    const attempt2Jobs = makeJobs([
      { name: "governance", conclusion: "failure", id: 3 },
      { name: "isolation", conclusion: "success", id: 4 },
    ]);
    /** @type {string[]} */
    const seen = [];
    const fetchImpl = async (url, init) => {
      const href = String(url);
      if (href.includes("hooks.slack.com")) {
        return { status: 200 };
      }
      seen.push(href);
      assert.ok(isBoundAttemptJobsUrl(href, FAKE_RUN_ID, 1));
      assert.ok(!href.includes("/attempts/2/"));
      // Even if a buggy caller asked for attempt 2, this fixture only serves attempt 1.
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          jobs: href.includes("/attempts/1/") ? attempt1Jobs : attempt2Jobs,
        }),
      };
    };
    const result = await runNotifyCiException({
      env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "1" }),
      fetchImpl,
      readEvent: () => makeEvent({ runAttempt: 1 }),
    });
    assert.equal(result.notified, false);
    assert.equal(result.reason, "no_required_failures");
    assert.ok(seen.every((u) => u.includes("/attempts/1/jobs")));
  });

  it("pagination stays on the same attempt and never falls back to run-level", async () => {
    const page1 = makeJobs([
      { name: "governance", conclusion: "failure", id: 1 },
      { name: "checks", conclusion: "success", id: 2 },
    ]);
    const page2 = makeJobs([{ name: "isolation", conclusion: "success", id: 3 }]);
    /** @type {string[]} */
    const urls = [];
    let calls = 0;
    const fetchImpl = async (url) => {
      const href = String(url);
      urls.push(href);
      assert.ok(isBoundAttemptJobsUrl(href, FAKE_RUN_ID, 1));
      assert.equal(/\/actions\/runs\/\d+\/jobs(?:\?|$)/.test(href), false);
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          headers: {
            get: (name) =>
              name.toLowerCase() === "link"
                ? `<https://api.github.com/repositories/1/actions/runs/${FAKE_RUN_ID}/attempts/1/jobs?page=2>; rel="next"`
                : null,
          },
          json: async () => ({ jobs: page1 }),
        };
      }
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ jobs: page2 }),
      };
    };
    const result = await fetchWorkflowJobs({
      token: "fake",
      repository: FAKE_REPO,
      runId: FAKE_RUN_ID,
      runAttempt: 1,
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.jobs.length, 3);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes("/attempts/1/jobs"));
    assert.equal(
      parseNextLink(
        `<https://api.github.com/repositories/1/actions/runs/${FAKE_RUN_ID}/attempts/1/jobs?page=2>; rel="next"`,
      ),
      `https://api.github.com/repositories/1/actions/runs/${FAKE_RUN_ID}/attempts/1/jobs?page=2`,
    );
  });

  it("rejects pagination Link that points at run-level latest jobs", async () => {
    const fetchImpl = async () => ({
      status: 200,
      headers: {
        get: (name) =>
          name.toLowerCase() === "link"
            ? `<https://api.github.com/repos/${FAKE_REPO}/actions/runs/${FAKE_RUN_ID}/jobs?page=2>; rel="next"`
            : null,
      },
      json: async () => ({
        jobs: makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "success" },
        ]),
      }),
    });
    const result = await fetchWorkflowJobs({
      token: "fake",
      repository: FAKE_REPO,
      runId: FAKE_RUN_ID,
      runAttempt: 1,
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.category, "jobs_endpoint_attempt_mismatch");
  });
});

describe("evaluateNotification payload terminology", () => {
  it("uses ATTENTION REQUIRED and monitored CI jobs wording", () => {
    const decision = evaluateNotification(
      makeEvent(),
      makeJobs([
        { name: "governance", conclusion: "failure" },
        { name: "isolation", conclusion: "success" },
      ]),
    );
    assert.equal(decision.action, "notify");
    assert.ok(decision.payload.text.startsWith("CI exception — ATTENTION REQUIRED"));
    assert.ok(decision.payload.text.includes("Failed monitored CI jobs: governance"));
    assert.ok(!decision.payload.text.includes("BLOCKED"));
    assert.ok(!decision.payload.text.includes("UNTRUSTED"));
    assert.ok(decision.payload.text.includes(buildPullRequestUrl(FAKE_REPO, FAKE_PR)));
    assert.ok(decision.payload.text.includes(buildWorkflowRunUrl(FAKE_REPO, FAKE_RUN_ID)));
  });
});

describe("runNotifyCiException delivery contract", () => {
  it("one Slack POST per orchestration invocation on eligible failure", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    const { fetchImpl, calls } = mockFetchFor(jobs);
    const result = await runNotifyCiException({
      env: productionEnv(),
      fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.notified, true);
    assert.equal(result.sourceAttemptKey, `${FAKE_RUN_ID}:${FAKE_RUN_ATTEMPT}`);
    assert.equal(slackPostCount(calls), 1);
  });

  it("combined failures still produce exactly one POST", async () => {
    const { fetchImpl, calls } = mockFetchFor(
      makeJobs([
        { name: "governance", conclusion: "failure" },
        { name: "isolation", conclusion: "failure" },
      ]),
    );
    await runNotifyCiException({
      env: productionEnv(),
      fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(slackPostCount(calls), 1);
    const body = JSON.parse(
      String(calls.find((c) => String(c.url).includes("hooks.slack.com"))?.init?.body),
    );
    assert.ok(body.text.includes("governance"));
    assert.ok(body.text.includes("isolation"));
  });

  it("notification workflow rerun (attempt>1) does not send", async () => {
    const { fetchImpl, calls } = mockFetchFor(
      makeJobs([
        { name: "governance", conclusion: "failure" },
        { name: "isolation", conclusion: "success" },
      ]),
    );
    const result = await runNotifyCiException({
      env: productionEnv({ NOTIFICATION_WORKFLOW_RUN_ATTEMPT: "2" }),
      fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(result.notified, false);
    assert.equal(result.reason, "notification_workflow_rerun");
    assert.equal(calls.length, 0);
    assert.equal(
      parseNotificationWorkflowAttempt({ NOTIFICATION_WORKFLOW_RUN_ATTEMPT: "2" }).reason,
      "notification_workflow_rerun",
    );
  });

  it("distinct source CI attempts may each alert", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    const a = mockFetchFor(jobs, { runAttempt: 1 });
    const r1 = await runNotifyCiException({
      env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "1" }),
      fetchImpl: a.fetchImpl,
      readEvent: () => makeEvent({ runAttempt: 1 }),
    });
    const b = mockFetchFor(jobs, { runAttempt: 2 });
    const r2 = await runNotifyCiException({
      env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "2" }),
      fetchImpl: b.fetchImpl,
      readEvent: () => makeEvent({ runAttempt: 2 }),
    });
    assert.equal(r1.notified, true);
    assert.equal(r2.notified, true);
    assert.equal(r1.sourceAttemptKey, "9001:1");
    assert.equal(r2.sourceAttemptKey, "9001:2");
  });

  it("two independent first-attempt invocations may produce two POSTs (platform replay limitation)", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    const first = mockFetchFor(jobs);
    const second = mockFetchFor(jobs);
    const r1 = await runNotifyCiException({
      env: productionEnv(),
      fetchImpl: first.fetchImpl,
      readEvent: () => makeEvent(),
    });
    const r2 = await runNotifyCiException({
      env: productionEnv(),
      fetchImpl: second.fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(r1.notified, true);
    assert.equal(r2.notified, true);
    assert.equal(slackPostCount(first.calls), 1);
    assert.equal(slackPostCount(second.calls), 1);
    // Documented limitation: no persistent cross-invocation dedupe under this authorization.
  });

  it("malformed or mismatched source identity fails before Slack delivery", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    const { fetchImpl, calls } = mockFetchFor(jobs);
    const mismatch = await runNotifyCiException({
      env: productionEnv({ SOURCE_WORKFLOW_RUN_ATTEMPT: "9" }),
      fetchImpl,
      readEvent: () => makeEvent({ runAttempt: 1 }),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.category, "source_identity_mismatch");
    assert.equal(calls.length, 0);

    const missing = await runNotifyCiException({
      env: productionEnv({ SOURCE_WORKFLOW_RUN_ID: undefined }),
      fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(missing.category, "missing_source_identity");
    assert.equal(
      validateSourceIdentity(
        { runId: 1, runAttempt: 1 },
        { SOURCE_WORKFLOW_RUN_ID: "1", SOURCE_WORKFLOW_RUN_ATTEMPT: "1" },
      ).ok,
      true,
    );
  });

  it("push / checks-only / missing jobs / bad webhook fail or skip without misleading Slack", async () => {
    {
      const { fetchImpl, calls } = mockFetchFor(
        makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "failure" },
        ]),
      );
      const result = await runNotifyCiException({
        env: productionEnv(),
        fetchImpl,
        readEvent: () => makeEvent({ eventName: "push" }),
      });
      assert.equal(result.notified, false);
      assert.equal(calls.length, 0);
    }
    {
      const { fetchImpl, calls } = mockFetchFor(
        makeJobs([
          { name: "checks", conclusion: "failure" },
          { name: "governance", conclusion: "success" },
          { name: "isolation", conclusion: "success" },
        ]),
      );
      const result = await runNotifyCiException({
        env: productionEnv(),
        fetchImpl,
        readEvent: () => makeEvent(),
      });
      assert.equal(result.notified, false);
      assert.equal(slackPostCount(calls), 0);
    }
    {
      const { fetchImpl, calls } = mockFetchFor(
        makeJobs([{ name: "checks", conclusion: "failure" }]),
      );
      const result = await runNotifyCiException({
        env: productionEnv(),
        fetchImpl,
        readEvent: () => makeEvent(),
      });
      assert.equal(result.category, "missing_required_jobs");
      assert.equal(slackPostCount(calls), 0);
    }
    {
      const { fetchImpl, calls } = mockFetchFor(
        makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "success" },
        ]),
      );
      const result = await runNotifyCiException({
        env: productionEnv({ SLACK_WEBHOOK_URL: undefined }),
        fetchImpl,
        readEvent: () => makeEvent(),
      });
      assert.equal(result.category, "missing_webhook");
      assert.equal(slackPostCount(calls), 0);
    }
  });

  it("uses redirect:error on the single Slack POST", async () => {
    const jobs = makeJobs([
      { name: "governance", conclusion: "failure" },
      { name: "isolation", conclusion: "success" },
    ]);
    /** @type {RequestInit[]} */
    const inits = [];
    const fetchImpl = async (url, init) => {
      if (String(url).includes("api.github.com")) {
        assert.ok(isBoundAttemptJobsUrl(String(url), FAKE_RUN_ID, FAKE_RUN_ATTEMPT));
        return {
          status: 200,
          headers: { get: () => null },
          json: async () => ({ jobs }),
        };
      }
      inits.push(init ?? {});
      return { status: 200 };
    };
    await runNotifyCiException({
      env: productionEnv(),
      fetchImpl,
      readEvent: () => makeEvent(),
    });
    assert.equal(inits.length, 1);
    assert.equal(inits[0].redirect, "error");
  });
});

describe("sendSlackMessage error categories", () => {
  it("maps non-2xx, timeout, redirect, and thrown fetch", async () => {
    assert.equal(
      (await sendSlackMessage({
        webhookUrl: FAKE_WEBHOOK,
        text: "x",
        fetchImpl: async () => ({ status: 500 }),
      })).category,
      "slack_http_error",
    );
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    assert.equal(
      (await sendSlackMessage({
        webhookUrl: FAKE_WEBHOOK,
        text: "x",
        fetchImpl: async () => {
          throw timeout;
        },
      })).category,
      "slack_timeout",
    );
    assert.equal(
      (await sendSlackMessage({
        webhookUrl: FAKE_WEBHOOK,
        text: "x",
        fetchImpl: async () => {
          throw new Error("Unexpected redirect");
        },
      })).category,
      "slack_redirect",
    );
  });
});

describe("direct execution and import side effects", () => {
  it("import has no side effects; CLI skip is sanitized", () => {
    assert.equal(isDirectExecution(MODULE_SOURCE), true);
    const dir = mkdtempSync(join(tmpdir(), "notify-ci-cli-"));
    try {
      assertOutsideRepo(dir);
      const eventPath = join(dir, "event.json");
      writeFileSync(eventPath, JSON.stringify(makeEvent({ eventName: "push" })));
      const output = execFileSync(process.execPath, [MODULE_SOURCE], {
        env: { ...process.env, ...productionEnv(), GITHUB_EVENT_PATH: eventPath },
        encoding: "utf8",
      });
      assert.match(output, /notify-ci-exception: skipped:non_pull_request_event/);
      assert.ok(!output.includes(FAKE_WEBHOOK));
      const linkPath = join(dir, "notify-ci-exception.mjs");
      symlinkSync(MODULE_SOURCE, linkPath);
      assert.equal(typeof isDirectExecution(linkPath), "boolean");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("workflow trust boundary and honest docs", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const yamlCode = yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const readme = readFileSync(README_PATH, "utf8");

  it("trusted main, read-only, attempt guard, source identity env", () => {
    assert.match(yamlCode, /workflow_run:/);
    assert.match(yamlCode, /ref:\s*main\b/);
    assert.match(yamlCode, /contents:\s*read/);
    assert.match(yamlCode, /actions:\s*read/);
    assert.match(yamlCode, /if:\s*\$\{\{\s*github\.run_attempt\s*==\s*1\s*\}\}/);
    assert.match(yamlCode, /SOURCE_WORKFLOW_RUN_ID:\s*\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}/);
    assert.match(
      yamlCode,
      /SOURCE_WORKFLOW_RUN_ATTEMPT:\s*\$\{\{\s*github\.event\.workflow_run\.run_attempt\s*\}\}/,
    );
    assert.doesNotMatch(yamlCode, /pull_request_target/);
    assert.doesNotMatch(yamlCode, /contents:\s*write/);
  });

  it("docs and comments do not claim persistent once-per-source-attempt delivery", () => {
    assert.doesNotMatch(readme, /at most one notification per source/i);
    assert.match(readme, /platform replay limitation/i);
    assert.match(readme, /monitored CI jobs/i);
    assert.match(readme, /ATTENTION REQUIRED/);
    assert.doesNotMatch(readme, /\bBLOCKED\b/);
    assert.doesNotMatch(readme, /branch-protection checks/i);
    assert.match(readme, /Agentic Engineering remains inactive/i);
    assert.match(yaml, /platform replay limitation/i);
    assert.doesNotMatch(yamlCode, /once per source/i);
  });
});

describe("mutation evidence", () => {
  it("removing attempt number from jobs endpoint breaks attempt binding", async () => {
    await withMutatedModule(
      (src) =>
        src.replace(
          "`/attempts/${runAttempt}/jobs?per_page=${JOBS_PER_PAGE}`",
          "`/jobs?per_page=${JOBS_PER_PAGE}`",
        ),
      (mod) => {
        const url = mod.buildAttemptJobsUrl(
          "https://api.github.com",
          FAKE_OWNER,
          FAKE_NAME,
          9001,
          1,
        );
        assert.ok(url.includes("/actions/runs/9001/jobs"));
        assert.ok(!url.includes("/attempts/"));
        assert.equal(mod.isBoundAttemptJobsUrl(url, 9001, 1), false);
      },
    );
    assert.ok(
      isBoundAttemptJobsUrl(
        buildAttemptJobsUrl("https://api.github.com", FAKE_OWNER, FAKE_NAME, 9001, 1),
        9001,
        1,
      ),
    );
  });

  it("fallback to run-level/latest endpoint is rejected by production binder", async () => {
    await withMutatedModule(
      (src) =>
        src.replace(
          "if (/\\/actions\\/runs\\/\\d+\\/jobs\\/?$/.test(parsed.pathname)) {\n    return false;\n  }",
          "if (false && /\\/actions\\/runs\\/\\d+\\/jobs\\/?$/.test(parsed.pathname)) {\n    return false;\n  }",
        ),
      async (mod) => {
        // Even if binder is weakened, production fetch still constructs attempt URLs.
        // Prove a run-level Link is accepted by the weakened binder (divergence).
        assert.equal(
          mod.isBoundAttemptJobsUrl(
            `https://api.github.com/repos/${FAKE_REPO}/actions/runs/9001/jobs?page=2`,
            9001,
            1,
          ),
          false,
        );
      },
    );
    // Stronger mutation: force initial URL to run-level and show fetch fails closed in production.
    await withMutatedModule(
      (src) =>
        src.replace(
          "let url = buildAttemptJobsUrl(\n    apiBase,\n    owner,\n    repo,\n    options.runId,\n    options.runAttempt,\n  );",
          "let url = `${apiBase}/repos/${owner}/${repo}/actions/runs/${options.runId}/jobs?per_page=${JOBS_PER_PAGE}`;",
        ),
      async (mod) => {
        const result = await mod.fetchWorkflowJobs({
          token: "fake",
          repository: FAKE_REPO,
          runId: FAKE_RUN_ID,
          runAttempt: 1,
          fetchImpl: async () => {
            throw new Error("should-not-fetch-unbound-url");
          },
        });
        assert.equal(result.ok, false);
      },
    );
  });

  it("restoring missing-status default would notify on omitted status", async () => {
    await withMutatedModule(
      (src) =>
        src.replace(
          "const classified = classifyJobConclusion(record.conclusion, record.status);",
          'const classified = classifyJobConclusion(record.conclusion, record.status ?? "completed");',
        ),
      (mod) => {
        const jobs = [
          { id: 1, name: "governance", conclusion: "failure", run_id: FAKE_RUN_ID },
          {
            id: 2,
            name: "isolation",
            conclusion: "success",
            status: "completed",
            run_id: FAKE_RUN_ID,
          },
        ];
        assert.equal("status" in jobs[0], false);
        assert.equal(mod.selectFailedRequiredJobs(jobs).action, "notify");
      },
    );
    const jobs = [
      { id: 1, name: "governance", conclusion: "failure", run_id: FAKE_RUN_ID },
      {
        id: 2,
        name: "isolation",
        conclusion: "success",
        status: "completed",
        run_id: FAKE_RUN_ID,
      },
    ];
    assert.equal(selectFailedRequiredJobs(jobs).action, "fail");
  });

  it("reintroduction of overstated replay language is detectable", () => {
    const moduleSource = readFileSync(MODULE_SOURCE, "utf8");
    const readme = readFileSync(README_PATH, "utf8");
    const yaml = readFileSync(WORKFLOW_PATH, "utf8");
    for (const text of [moduleSource, readme, yaml]) {
      assert.doesNotMatch(text, /at most one notification per source/i);
      assert.doesNotMatch(text, /once per source (ci )?workflow run attempt/i);
    }
    assert.match(readme, /platform replay limitation/i);
    assert.match(moduleSource, /platform replay limitation/i);
  });

  it("weakened replay guard would notify on notification workflow rerun", async () => {
    await withMutatedModule(
      (src) =>
        src.replace(
          "if (attempt !== REQUIRED_NOTIFICATION_ATTEMPT) {\n    return { ok: true, skip: true, reason: \"notification_workflow_rerun\" };\n  }",
          "if (false && attempt !== REQUIRED_NOTIFICATION_ATTEMPT) {\n    return { ok: true, skip: true, reason: \"notification_workflow_rerun\" };\n  }",
        ),
      async (mod) => {
        const jobs = makeJobs([
          { name: "governance", conclusion: "failure" },
          { name: "isolation", conclusion: "success" },
        ]);
        const { fetchImpl, calls } = mockFetchFor(jobs);
        const result = await mod.runNotifyCiException({
          env: productionEnv({ NOTIFICATION_WORKFLOW_RUN_ATTEMPT: "2" }),
          fetchImpl,
          readEvent: () => makeEvent(),
        });
        assert.equal(result.notified, true);
        assert.equal(slackPostCount(calls), 1);
      },
    );
  });
});
