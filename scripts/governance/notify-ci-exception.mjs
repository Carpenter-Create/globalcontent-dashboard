#!/usr/bin/env node
/**
 * Slack CI-exception notifier — dependency-free (Node built-ins + native fetch).
 *
 * Advisory notification-only. GitHub remains authoritative. No approvals,
 * remediation, or autonomous routing. Slack target: #global-content-dev.
 *
 * Delivery contract (no persistent / cross-invocation deduplication):
 * - At most one Slack POST per notifier orchestration invocation.
 * - Rerunning the notification workflow is blocked by github.run_attempt == 1.
 * - A rerun of the source CI workflow is a distinct source attempt and may alert.
 * - An independently duplicated first-attempt delivery of the same workflow_run
 *   event may produce another notification (platform replay limitation).
 * Jobs are always fetched from the attempt-specific GitHub API endpoint for the
 * validated source workflow_run.id + run_attempt.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_JOB_NAMES = Object.freeze(["governance", "isolation"]);

/** Exhaustive GitHub Actions job conclusions accepted as completed. */
export const VALID_JOB_CONCLUSIONS = Object.freeze([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

/** Failure-class conclusions that trigger a notification for monitored jobs. */
export const FAILURE_CONCLUSIONS = Object.freeze([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

/** Non-failure completed conclusions (no notification by themselves). */
export const NONFAILURE_CONCLUSIONS = Object.freeze(
  VALID_JOB_CONCLUSIONS.filter((c) => !FAILURE_CONCLUSIONS.includes(c)),
);

const VALID_CONCLUSION_SET = new Set(VALID_JOB_CONCLUSIONS);
const FAILURE_CONCLUSION_SET = new Set(FAILURE_CONCLUSIONS);

/** Job fields compared when deduplicating paginated records. */
export const JOB_IDENTITY_FIELDS = Object.freeze([
  "id",
  "name",
  "status",
  "conclusion",
  "run_id",
  "check_run_id",
  "workflow_name",
]);

export const SLACK_TARGET_LABEL = "#global-content-dev";
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_JOB_PAGES = 10;
export const JOBS_PER_PAGE = 100;
export const REQUIRED_NOTIFICATION_ATTEMPT = 1;

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const CONTROL_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;
const STATUS_LIKE_CONCLUSIONS = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/**
 * True when this module is the process entrypoint (not merely imported).
 * Normalizes relative argv paths and symlinks before comparison.
 *
 * @param {string | undefined} [entryArg]
 */
export function isDirectExecution(entryArg = process.argv[1]) {
  if (!entryArg) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const entryPath = realpathSync(resolve(entryArg));
    return modulePath === entryPath;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isPositiveInt(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function parsePositiveInt(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * Source-attempt correlator for logs/tests (not a persistent dedupe key).
 *
 * @param {number} runId
 * @param {number} runAttempt
 */
export function buildSourceAttemptKey(runId, runAttempt) {
  return `${runId}:${runAttempt}`;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRepoFullName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!REPO_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHeadSha(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!SHA_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Escape Slack mrkdwn control characters and neutralize mention forms.
 *
 * @param {unknown} input
 * @param {number} [maxLen]
 */
export function sanitizeSlackText(input, maxLen = 200) {
  let text = typeof input === "string" ? input : String(input ?? "");
  text = text.replace(CONTROL_RE, "");
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/\n+/g, " ");
  text = text.replace(/<@[A-Za-z0-9]+>/g, "[mention]");
  text = text.replace(/<!subteam\^[^>]+>/g, "[subteam]");
  text = text.replace(/<!(?:channel|here|everyone)(?:\|[^>]*)?>/gi, "[broadcast]");
  text = text.replace(/@(?:channel|here|everyone)\b/gi, "[broadcast]");
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/**
 * Structural HTTPS Slack webhook validation. Never logs the URL.
 *
 * @param {unknown} url
 * @returns {{ ok: true, url: string } | { ok: false, category: string }}
 */
export function validateWebhookUrl(url) {
  if (url == null || url === "") {
    return { ok: false, category: "missing_webhook" };
  }
  if (typeof url !== "string") {
    return { ok: false, category: "malformed_webhook" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, category: "malformed_webhook" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, category: "malformed_webhook" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, category: "malformed_webhook" };
  }
  if (parsed.hostname !== "hooks.slack.com") {
    return { ok: false, category: "webhook_host_rejected" };
  }
  if (!parsed.pathname.startsWith("/services/")) {
    return { ok: false, category: "malformed_webhook" };
  }
  if (parsed.pathname.length < "/services/T/B/X".length) {
    return { ok: false, category: "malformed_webhook" };
  }
  return { ok: true, url };
}

/**
 * @param {string} repository
 * @param {number} runId
 */
export function buildWorkflowRunUrl(repository, runId) {
  return `https://github.com/${repository}/actions/runs/${runId}`;
}

/**
 * @param {string} repository
 * @param {number} prNumber
 */
export function buildPullRequestUrl(repository, prNumber) {
  return `https://github.com/${repository}/pull/${prNumber}`;
}

/**
 * Notification workflow may send only on its first attempt.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {
 *   | { ok: true, attempt: number }
 *   | { ok: true, skip: true, reason: string }
 *   | { ok: false, category: string }
 * }
 */
export function parseNotificationWorkflowAttempt(env) {
  const raw = env.NOTIFICATION_WORKFLOW_RUN_ATTEMPT;
  if (raw == null || raw === "") {
    return { ok: false, category: "missing_notification_attempt" };
  }
  const attempt = parsePositiveInt(raw);
  if (attempt == null) {
    return { ok: false, category: "malformed_notification_attempt" };
  }
  if (attempt !== REQUIRED_NOTIFICATION_ATTEMPT) {
    return { ok: true, skip: true, reason: "notification_workflow_rerun" };
  }
  return { ok: true, attempt };
}

/**
 * Cross-check trusted env identity against the parsed source workflow_run.
 *
 * @param {{ runId: number, runAttempt: number }} context
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function validateSourceIdentity(context, env) {
  const envRunId = parsePositiveInt(env.SOURCE_WORKFLOW_RUN_ID);
  const envAttempt = parsePositiveInt(env.SOURCE_WORKFLOW_RUN_ATTEMPT);
  if (env.SOURCE_WORKFLOW_RUN_ID == null || env.SOURCE_WORKFLOW_RUN_ID === "") {
    return { ok: false, category: "missing_source_identity" };
  }
  if (env.SOURCE_WORKFLOW_RUN_ATTEMPT == null || env.SOURCE_WORKFLOW_RUN_ATTEMPT === "") {
    return { ok: false, category: "missing_source_identity" };
  }
  if (envRunId == null || envAttempt == null) {
    return { ok: false, category: "malformed_source_identity" };
  }
  if (envRunId !== context.runId || envAttempt !== context.runAttempt) {
    return { ok: false, category: "source_identity_mismatch" };
  }
  return {
    ok: true,
    sourceAttemptKey: buildSourceAttemptKey(context.runId, context.runAttempt),
  };
}

/**
 * Accept exactly one unique validated PR number. Exact duplicate associations
 * for the same PR may be deduplicated.
 *
 * @param {unknown} pullRequests
 * @returns {
 *   | { ok: true, prNumber: number }
 *   | { ok: false, category: string }
 * }
 */
export function resolveUniquePullRequestNumber(pullRequests) {
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    return { ok: false, category: "missing_pull_request" };
  }
  /** @type {Set<number>} */
  const numbers = new Set();
  for (const entry of pullRequests) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, category: "malformed_pull_request" };
    }
    const number = /** @type {{ number?: unknown }} */ (entry).number;
    if (!isPositiveInt(number)) {
      return { ok: false, category: "malformed_pull_request" };
    }
    numbers.add(number);
  }
  if (numbers.size === 0) {
    return { ok: false, category: "missing_pull_request" };
  }
  if (numbers.size > 1) {
    return { ok: false, category: "ambiguous_pull_request" };
  }
  return { ok: true, prNumber: [...numbers][0] };
}

/**
 * Require explicit status === "completed" and an allowlisted conclusion.
 * Missing/null status is never synthesized as completed.
 *
 * @param {unknown} conclusion
 * @param {unknown} status
 * @returns {
 *   | { ok: true, conclusion: string, failure: boolean }
 *   | { ok: false, category: string }
 * }
 */
export function classifyJobConclusion(conclusion, status) {
  if (status === undefined || status === null || status === "") {
    return { ok: false, category: "incomplete_job_data" };
  }
  if (typeof status !== "string") {
    return { ok: false, category: "malformed_job_data" };
  }
  if (status !== "completed") {
    if (STATUS_LIKE_CONCLUSIONS.has(status)) {
      return { ok: false, category: "incomplete_job_data" };
    }
    return { ok: false, category: "incomplete_job_data" };
  }

  if (conclusion == null || conclusion === "") {
    return { ok: false, category: "incomplete_job_data" };
  }
  if (typeof conclusion !== "string") {
    return { ok: false, category: "malformed_job_data" };
  }
  if (STATUS_LIKE_CONCLUSIONS.has(conclusion)) {
    return { ok: false, category: "incomplete_job_data" };
  }
  if (!VALID_CONCLUSION_SET.has(conclusion)) {
    return { ok: false, category: "unknown_job_conclusion" };
  }
  return {
    ok: true,
    conclusion,
    failure: FAILURE_CONCLUSION_SET.has(conclusion),
  };
}

/**
 * @param {unknown} job
 * @returns {Record<string, unknown> | null}
 */
export function extractJobIdentity(job) {
  if (!job || typeof job !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (job);
  if (!isPositiveInt(record.id)) return null;
  if (typeof record.name !== "string" || record.name.length === 0) return null;
  /** @type {Record<string, unknown>} */
  const identity = {};
  for (const field of JOB_IDENTITY_FIELDS) {
    if (field in record) identity[field] = record[field];
  }
  return identity;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
export function jobIdentitiesEqual(a, b) {
  for (const field of JOB_IDENTITY_FIELDS) {
    const aHas = Object.prototype.hasOwnProperty.call(a, field);
    const bHas = Object.prototype.hasOwnProperty.call(b, field);
    if (aHas !== bHas) return false;
    if (aHas && a[field] !== b[field]) return false;
  }
  return true;
}

/**
 * Deduplicate jobs by id. Exact repeated pagination records are kept once.
 * Conflicting records for the same id fail closed. First record wins — a later
 * duplicate never overwrites and hides an earlier failure.
 *
 * @param {unknown} jobs
 * @returns {{ ok: true, byName: Map<string, object[]> } | { ok: false, category: string }}
 */
export function indexJobs(jobs) {
  if (!Array.isArray(jobs)) {
    return { ok: false, category: "malformed_api_response" };
  }
  /** @type {Map<number, { job: object, identity: Record<string, unknown> }>} */
  const byId = new Map();
  for (const job of jobs) {
    const identity = extractJobIdentity(job);
    if (!identity) {
      return { ok: false, category: "malformed_api_response" };
    }
    const id = /** @type {number} */ (identity.id);
    const existing = byId.get(id);
    if (existing) {
      if (!jobIdentitiesEqual(existing.identity, identity)) {
        return { ok: false, category: "conflicting_job_records" };
      }
      // Exact duplicate — keep the first record; never overwrite.
      continue;
    }
    byId.set(id, { job: /** @type {object} */ (job), identity });
  }

  /** @type {Map<string, object[]>} */
  const byName = new Map();
  for (const { job, identity } of byId.values()) {
    const name = /** @type {string} */ (identity.name);
    const list = byName.get(name) ?? [];
    list.push(job);
    byName.set(name, list);
  }
  return { ok: true, byName };
}

/**
 * Require both governance and isolation jobs with valid completed conclusions.
 * Notify only when at least one has a failure-class conclusion.
 *
 * @param {unknown} jobs
 * @returns {
 *   | { action: "notify", failedJobs: string[] }
 *   | { action: "skip", reason: string }
 *   | { action: "fail", category: string }
 * }
 */
export function selectFailedRequiredJobs(jobs) {
  const indexed = indexJobs(jobs);
  if (!indexed.ok) return { action: "fail", category: indexed.category };

  /** @type {string[]} */
  const failedJobs = [];
  for (const required of REQUIRED_JOB_NAMES) {
    const matches = indexed.byName.get(required);
    if (!matches || matches.length === 0) {
      return { action: "fail", category: "missing_required_jobs" };
    }
    for (const job of matches) {
      const record = /** @type {{ conclusion?: unknown, status?: unknown }} */ (job);
      const classified = classifyJobConclusion(record.conclusion, record.status);
      if (!classified.ok) {
        return { action: "fail", category: classified.category };
      }
      if (classified.failure && !failedJobs.includes(required)) {
        failedJobs.push(required);
      }
    }
  }

  if (failedJobs.length === 0) {
    return { action: "skip", reason: "no_required_failures" };
  }
  return { action: "notify", failedJobs };
}

/**
 * Extract and validate fields from a workflow_run completed event.
 *
 * @param {unknown} event
 * @returns {
 *   | { ok: true, context: {
 *       repository: string,
 *       runId: number,
 *       runAttempt: number,
 *       sourceAttemptKey: string,
 *       headSha: string,
 *       prNumber: number,
 *       eventName: string,
 *     } }
 *   | { ok: false, category: string }
 *   | { ok: true, skip: true, reason: string }
 * }
 */
export function parseWorkflowRunEvent(event) {
  if (!event || typeof event !== "object") {
    return { ok: false, category: "malformed_event" };
  }
  const workflowRun = /** @type {{ workflow_run?: unknown }} */ (event).workflow_run;
  if (!workflowRun || typeof workflowRun !== "object") {
    return { ok: false, category: "malformed_event" };
  }
  const wr = /** @type {Record<string, unknown>} */ (workflowRun);

  const eventName = wr.event;
  if (typeof eventName !== "string" || eventName.length === 0) {
    return { ok: false, category: "malformed_event" };
  }
  if (eventName !== "pull_request") {
    return { ok: true, skip: true, reason: "non_pull_request_event" };
  }

  const repository =
    normalizeRepoFullName(
      wr.repository && typeof wr.repository === "object"
        ? /** @type {{ full_name?: unknown }} */ (wr.repository).full_name
        : null,
    ) ??
    normalizeRepoFullName(
      /** @type {{ repository?: unknown }} */ (event).repository &&
        typeof /** @type {{ repository?: unknown }} */ (event).repository === "object"
        ? /** @type {{ full_name?: unknown }} */ (
            /** @type {{ repository: object }} */ (event).repository
          ).full_name
        : null,
    );

  if (!repository) {
    return { ok: false, category: "malformed_event" };
  }

  if (!isPositiveInt(wr.id)) {
    return { ok: false, category: "malformed_event" };
  }

  const runAttempt = parsePositiveInt(wr.run_attempt);
  if (runAttempt == null) {
    return { ok: false, category: "malformed_event" };
  }

  const headSha = normalizeHeadSha(wr.head_sha);
  if (!headSha) {
    return { ok: false, category: "malformed_event" };
  }

  const prResolved = resolveUniquePullRequestNumber(wr.pull_requests);
  if (!prResolved.ok) {
    return { ok: false, category: prResolved.category };
  }

  return {
    ok: true,
    context: {
      repository,
      runId: wr.id,
      runAttempt,
      sourceAttemptKey: buildSourceAttemptKey(wr.id, runAttempt),
      headSha,
      prNumber: prResolved.prNumber,
      eventName,
    },
  };
}

/**
 * Build the exact Slack text payload. Includes only allowlisted fields.
 * "ATTENTION REQUIRED" is advisory copy for a failed monitored CI job — not a
 * durable Agentic Engineering control state and not a proof of merge blocking.
 *
 * @param {{
 *   repository: string,
 *   prNumber: number,
 *   failedJobs: string[],
 *   runId: number,
 *   headSha: string,
 * }} input
 */
export function buildSlackPayload(input) {
  const repository = sanitizeSlackText(input.repository, 200);
  const prNumber = input.prNumber;
  const failedJobs = input.failedJobs
    .filter((name) => REQUIRED_JOB_NAMES.includes(name))
    .map((name) => sanitizeSlackText(name, 64));
  const headSha = sanitizeSlackText(input.headSha, 40);
  const prUrl = buildPullRequestUrl(input.repository, prNumber);
  const runUrl = buildWorkflowRunUrl(input.repository, input.runId);

  const text = [
    "CI exception — ATTENTION REQUIRED",
    "",
    `Repository: ${repository}`,
    `PR: #${prNumber} — ${prUrl}`,
    `Failed monitored CI jobs: ${failedJobs.join(", ")}`,
    `Workflow run: ${runUrl}`,
    `Head SHA: ${headSha}`,
    "Recommended action: Inspect GitHub checks.",
  ].join("\n");

  return {
    text,
    fields: {
      repository: input.repository,
      prNumber,
      prUrl,
      failedJobs: [...input.failedJobs],
      runUrl,
      headSha: input.headSha,
      targetLabel: SLACK_TARGET_LABEL,
    },
  };
}

/**
 * @param {string} linkHeader
 * @returns {string | null}
 */
export function parseNextLink(linkHeader) {
  if (typeof linkHeader !== "string" || !linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

/**
 * Attempt-specific jobs URL for a validated source run/attempt.
 *
 * @param {string} apiBase
 * @param {string} owner
 * @param {string} repo
 * @param {number} runId
 * @param {number} runAttempt
 */
export function buildAttemptJobsUrl(apiBase, owner, repo, runId, runAttempt) {
  return (
    `${apiBase}/repos/${owner}/${repo}/actions/runs/${runId}` +
    `/attempts/${runAttempt}/jobs?per_page=${JOBS_PER_PAGE}`
  );
}

/**
 * True only when the URL is the attempt-specific jobs endpoint for the exact
 * source run id and attempt. Rejects run-level `/jobs` (latest) endpoints.
 *
 * @param {string} urlString
 * @param {number} runId
 * @param {number} runAttempt
 */
export function isBoundAttemptJobsUrl(urlString, runId, runAttempt) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com") {
    return false;
  }
  // Reject run-level latest jobs endpoint (no /attempts/{n}/ segment).
  if (/\/actions\/runs\/\d+\/jobs\/?$/.test(parsed.pathname)) {
    return false;
  }
  const match = parsed.pathname.match(
    /\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\/?$/,
  );
  if (!match) return false;
  return Number(match[1]) === runId && Number(match[2]) === runAttempt;
}

/**
 * Fetch jobs for the exact source workflow_run attempt. Never uses the
 * run-level `/actions/runs/{id}/jobs` endpoint.
 *
 * @param {{
 *   token: string,
 *   repository: string,
 *   runId: number,
 *   runAttempt: number,
 *   fetchImpl?: typeof fetch,
 *   apiBase?: string,
 * }} options
 */
export async function fetchWorkflowJobs(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiBase = options.apiBase ?? "https://api.github.com";
  const [owner, repo] = options.repository.split("/");
  if (!owner || !repo) {
    return { ok: false, category: "malformed_event" };
  }
  if (!isPositiveInt(options.runId) || !isPositiveInt(options.runAttempt)) {
    return { ok: false, category: "malformed_source_identity" };
  }

  /** @type {unknown[]} */
  const allJobs = [];
  let url = buildAttemptJobsUrl(
    apiBase,
    owner,
    repo,
    options.runId,
    options.runAttempt,
  );
  if (!isBoundAttemptJobsUrl(url, options.runId, options.runAttempt)) {
    return { ok: false, category: "github_api_failure" };
  }

  for (let page = 0; page < MAX_JOB_PAGES; page += 1) {
    if (!isBoundAttemptJobsUrl(url, options.runId, options.runAttempt)) {
      return { ok: false, category: "jobs_endpoint_attempt_mismatch" };
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${options.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err && typeof err === "object" ? /** @type {{ name?: string }} */ (err).name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, category: "github_api_timeout" };
      }
      return { ok: false, category: "github_api_failure" };
    }

    if (!response || typeof response.status !== "number") {
      return { ok: false, category: "github_api_failure" };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, category: "github_api_failure" };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, category: "malformed_api_response" };
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.jobs)) {
      return { ok: false, category: "malformed_api_response" };
    }
    allJobs.push(...body.jobs);

    const headers = response.headers;
    const link =
      headers && typeof headers.get === "function" ? headers.get("link") : null;
    const next = parseNextLink(link ?? "");
    if (!next) {
      return { ok: true, jobs: allJobs };
    }
    if (!isBoundAttemptJobsUrl(next, options.runId, options.runAttempt)) {
      return { ok: false, category: "jobs_endpoint_attempt_mismatch" };
    }
    url = next;
  }

  return { ok: false, category: "github_api_failure" };
}

/**
 * Send at most one Slack message. Never logs webhook, payload, or response body.
 *
 * @param {{
 *   webhookUrl: string,
 *   text: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function sendSlackMessage(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: options.text }),
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err && typeof err === "object" ? /** @type {{ name?: string }} */ (err).name : "";
    const message =
      err && typeof err === "object" && typeof /** @type {{ message?: unknown }} */ (err).message === "string"
        ? /** @type {{ message: string }} */ (err).message
        : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, category: "slack_timeout" };
    }
    if (/redirect/i.test(name) || /redirect/i.test(message)) {
      return { ok: false, category: "slack_redirect" };
    }
    return { ok: false, category: "slack_fetch_error" };
  }

  if (!response || typeof response.status !== "number") {
    return { ok: false, category: "slack_fetch_error" };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, category: "slack_http_error" };
  }
  return { ok: true };
}

/**
 * Pure evaluation: event + jobs → notify/skip/fail (no I/O).
 *
 * @param {unknown} event
 * @param {unknown} jobs
 */
export function evaluateNotification(event, jobs) {
  const parsed = parseWorkflowRunEvent(event);
  if (!parsed.ok) return { action: "fail", category: parsed.category };
  if ("skip" in parsed && parsed.skip) {
    return { action: "skip", reason: parsed.reason };
  }

  const selection = selectFailedRequiredJobs(jobs);
  if (selection.action === "fail") {
    return { action: "fail", category: selection.category };
  }
  if (selection.action === "skip") {
    return { action: "skip", reason: selection.reason };
  }

  const payload = buildSlackPayload({
    repository: parsed.context.repository,
    prNumber: parsed.context.prNumber,
    failedJobs: selection.failedJobs,
    runId: parsed.context.runId,
    headSha: parsed.context.headSha,
  });

  return {
    action: "notify",
    context: parsed.context,
    failedJobs: selection.failedJobs,
    payload,
  };
}

/**
 * Orchestrate env/network. Returns sanitized lifecycle result.
 *
 * Production delivery contract:
 * - Notification workflow attempt must be 1 (paired with workflow `if`).
 * - Source id + attempt are cross-checked from env and used for the
 *   attempt-specific jobs API path.
 * - At most one Slack POST per orchestration invocation (not persistent
 *   cross-invocation deduplication).
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   readEvent?: () => unknown,
 * }} [options]
 */
export async function runNotifyCiException(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  /** @type {Array<{ url: string, init?: RequestInit }>} */
  const outbound = [];

  const trackedFetch = async (url, init) => {
    outbound.push({ url: String(url), init });
    return fetchImpl(url, init);
  };

  const notificationAttempt = parseNotificationWorkflowAttempt(env);
  if (!notificationAttempt.ok) {
    return { ok: false, category: notificationAttempt.category, outboundCount: 0, notified: false };
  }
  if ("skip" in notificationAttempt && notificationAttempt.skip) {
    return {
      ok: true,
      category: "skipped",
      reason: notificationAttempt.reason,
      outboundCount: 0,
      notified: false,
    };
  }

  let event;
  try {
    if (options.readEvent) {
      event = options.readEvent();
    } else {
      const eventPath = env.GITHUB_EVENT_PATH;
      if (!eventPath || typeof eventPath !== "string") {
        return { ok: false, category: "malformed_event", outboundCount: 0, notified: false };
      }
      event = JSON.parse(readFileSync(eventPath, "utf8"));
    }
  } catch {
    return { ok: false, category: "malformed_event", outboundCount: 0, notified: false };
  }

  const parsed = parseWorkflowRunEvent(event);
  if (!parsed.ok) {
    return { ok: false, category: parsed.category, outboundCount: 0, notified: false };
  }
  if ("skip" in parsed && parsed.skip) {
    return {
      ok: true,
      category: "skipped",
      reason: parsed.reason,
      outboundCount: 0,
      notified: false,
    };
  }

  const identityCheck = validateSourceIdentity(parsed.context, env);
  if (!identityCheck.ok) {
    return { ok: false, category: identityCheck.category, outboundCount: 0, notified: false };
  }

  const token = env.GITHUB_TOKEN;
  if (!token || typeof token !== "string") {
    return { ok: false, category: "github_api_failure", outboundCount: 0, notified: false };
  }

  const jobsResult = await fetchWorkflowJobs({
    token,
    repository: parsed.context.repository,
    runId: parsed.context.runId,
    runAttempt: parsed.context.runAttempt,
    fetchImpl: trackedFetch,
  });
  if (!jobsResult.ok) {
    return {
      ok: false,
      category: jobsResult.category,
      outboundCount: outbound.length,
      notified: false,
      sourceAttemptKey: parsed.context.sourceAttemptKey,
    };
  }

  const decision = evaluateNotification(event, jobsResult.jobs);
  if (decision.action === "fail") {
    return {
      ok: false,
      category: decision.category,
      outboundCount: outbound.length,
      notified: false,
      sourceAttemptKey: parsed.context.sourceAttemptKey,
    };
  }
  if (decision.action === "skip") {
    return {
      ok: true,
      category: "skipped",
      reason: decision.reason,
      outboundCount: outbound.length,
      notified: false,
      sourceAttemptKey: parsed.context.sourceAttemptKey,
    };
  }

  const webhook = validateWebhookUrl(env.SLACK_WEBHOOK_URL);
  if (!webhook.ok) {
    return {
      ok: false,
      category: webhook.category,
      outboundCount: outbound.length,
      notified: false,
      sourceAttemptKey: parsed.context.sourceAttemptKey,
    };
  }

  // At most one Slack POST per orchestration invocation.
  const slackResult = await sendSlackMessage({
    webhookUrl: webhook.url,
    text: decision.payload.text,
    fetchImpl: trackedFetch,
  });
  if (!slackResult.ok) {
    return {
      ok: false,
      category: slackResult.category,
      outboundCount: outbound.length,
      notified: false,
      sourceAttemptKey: parsed.context.sourceAttemptKey,
    };
  }

  return {
    ok: true,
    category: "notified",
    failedJobs: decision.failedJobs,
    outboundCount: outbound.length,
    notified: true,
    sourceAttemptKey: parsed.context.sourceAttemptKey,
    slackRequests: outbound.filter((r) => String(r.url).includes("hooks.slack.com")).length,
  };
}

/**
 * CLI entry — sanitized lifecycle/error categories only on stdout/stderr.
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   readEvent?: () => unknown,
 * }} [options]
 */
export async function main(options = {}) {
  const result = await runNotifyCiException(options);
  if (!result.ok) {
    console.error(`notify-ci-exception: ${result.category}`);
    return 1;
  }
  if (result.notified) {
    console.log("notify-ci-exception: notified");
  } else {
    console.log(`notify-ci-exception: skipped:${result.reason ?? "n/a"}`);
  }
  return 0;
}

if (isDirectExecution()) {
  main().then((code) => {
    process.exit(code);
  });
}
