#!/usr/bin/env node
/**
 * Safe wrapper for local security harnesses.
 * Captures Supabase CLI status in memory; never forwards raw CLI output.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  loadHarnessConfig,
  loadHarnessConfigWithApp,
  validateLoopbackHttpUrl,
  HarnessConfigError,
} from "./lib/local-harness-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "../..");

export const ALLOWED_HARNESS_IDS = Object.freeze([
  "b3",
  "c-group-1",
  "client-assets",
  "l7",
  "portal",
]);

/** @type {Record<string, string>} */
export const HARNESS_SCRIPTS = Object.freeze({
  b3: "scripts/security/b3-cross-org-isolation.mjs",
  "c-group-1": "scripts/security/c-group-1-auth-failures.mjs",
  "client-assets": "scripts/security/client-asset-routes-cross-org.mjs",
  l7: "scripts/security/l7-chain-of-title-gate.mjs",
  portal: "scripts/security/portal-cross-org.mjs",
});

const APP_REQUIRED = new Set(["client-assets", "portal"]);
export const DEFAULT_APP_URL = "http://127.0.0.1:3100";
const CLI_TIMEOUT_MS = 30_000;
const HARNESS_TIMEOUT_MS = 600_000;

/** Minimal non-secret operational variables for Supabase CLI child processes. */
export const SUPABASE_CLI_ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "DOCKER_HOST",
  "XDG_RUNTIME_DIR",
  "CI",
]);

/** Minimal non-secret operational variables for harness child processes. */
export const HARNESS_CHILD_ENV_KEYS = Object.freeze([
  "PATH",
  "NODE_ENV",
  "TZ",
  "CI",
]);

/**
 * @param {NodeJS.ProcessEnv} source
 * @param {readonly string[]} allowlist
 */
export function pickEnv(source, allowlist) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const key of allowlist) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

/**
 * @param {string} id
 */
export function resolveHarnessId(id) {
  if (!ALLOWED_HARNESS_IDS.includes(id)) {
    const err = new Error("harness-identifier-not-allowed");
    throw err;
  }
  return HARNESS_SCRIPTS[id];
}

/**
 * @param {string[]} argv
 */
export function parseWrapperArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { error: "missing-harness-identifier" };
  }
  const harnessId = args[0];
  if (args[0].startsWith("-")) {
    return { error: "unknown-flag" };
  }
  if (!ALLOWED_HARNESS_IDS.includes(harnessId)) {
    return { error: "harness-identifier-not-allowed" };
  }

  let appUrl;
  let seenAppUrl = false;
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === "--app-url") {
      if (seenAppUrl) return { error: "duplicate-app-url" };
      if (!APP_REQUIRED.has(harnessId)) return { error: "app-url-not-supported" };
      if (!args[i + 1] || args[i + 1].startsWith("-")) return { error: "missing-app-url-value" };
      appUrl = args[++i];
      seenAppUrl = true;
      continue;
    }
    return { error: "unknown-argument" };
  }

  return { harnessId, appUrl };
}

/**
 * @param {string} stdout
 */
export function parseSupabaseStatusJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("supabase-status-parse-failed");
  }
  for (const field of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
      throw new Error("supabase-status-missing-field");
    }
  }
  return {
    supabaseUrl: parsed.API_URL,
    supabaseAnonKey: parsed.ANON_KEY,
    supabaseServiceRoleKey: parsed.SERVICE_ROLE_KEY,
  };
}

/**
 * @param {{ spawnImpl?: typeof spawnSync, cwd?: string, cliPath?: string, timeoutMs?: number, parentEnv?: NodeJS.ProcessEnv }} [options]
 */
export function fetchLocalSupabaseConfig(options = {}) {
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const cwd = options.cwd ?? REPO_ROOT;
  const cliPath = options.cliPath ?? "supabase";
  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS;
  const parentEnv = options.parentEnv ?? process.env;
  const cliEnv = pickEnv(parentEnv, SUPABASE_CLI_ENV_KEYS);

  const result = spawnImpl(cliPath, ["status", "-o", "json"], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: false,
    env: cliEnv,
    killSignal: "SIGTERM",
  });

  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("supabase-status-timeout");
  }
  if (result.signal) {
    throw new Error("supabase-status-signal-terminated");
  }
  if (result.status !== 0) {
    throw new Error("supabase-status-unavailable");
  }

  const rawStdout = result.stdout ?? "";
  if ((rawStdout + (result.stderr ?? "")).includes("__RAW_CLI_SENTINEL__")) {
    throw new Error("supabase-status-output-leak");
  }

  const config = parseSupabaseStatusJson(rawStdout);
  validateLoopbackHttpUrl(config.supabaseUrl, "SUPABASE_URL", 54321);
  return config;
}

/**
 * @param {ReturnType<typeof fetchLocalSupabaseConfig>} supabaseConfig
 * @param {string | undefined} appUrl
 * @param {NodeJS.ProcessEnv} [parentEnv]
 */
export function buildChildEnv(supabaseConfig, appUrl, parentEnv = process.env) {
  const env = pickEnv(parentEnv, HARNESS_CHILD_ENV_KEYS);
  env.SUPABASE_URL = supabaseConfig.supabaseUrl;
  env.SUPABASE_ANON_KEY = supabaseConfig.supabaseAnonKey;
  env.SUPABASE_SERVICE_ROLE_KEY = supabaseConfig.supabaseServiceRoleKey;
  if (appUrl) env.APP_URL = appUrl;
  return env;
}

const WRAPPER_ERROR_CATEGORIES = new Set([
  "missing-harness-identifier",
  "harness-identifier-not-allowed",
  "unknown-flag",
  "unknown-argument",
  "duplicate-app-url",
  "missing-app-url-value",
  "app-url-not-supported",
  "supabase-status-timeout",
  "supabase-status-signal-terminated",
  "supabase-status-unavailable",
  "supabase-status-parse-failed",
  "supabase-status-missing-field",
  "supabase-status-output-leak",
  "harness-timeout",
  "harness-signal-terminated",
  "harness-spawn-failed",
]);

/**
 * @param {unknown} err
 */
export function mapWrapperError(err) {
  if (err instanceof HarnessConfigError) {
    return `${err.variable}:${err.category}`;
  }
  if (err instanceof Error && WRAPPER_ERROR_CATEGORIES.has(err.message)) {
    return err.message;
  }
  return "wrapper-operational-error";
}

/**
 * @param {string} harnessId
 * @param {{ appUrl?: string, spawnImpl?: typeof spawnSync, cwd?: string, cliPath?: string, parentEnv?: NodeJS.ProcessEnv }} [options]
 */
export function runHarness(harnessId, options = {}) {
  resolveHarnessId(harnessId);
  const scriptPath = join(REPO_ROOT, HARNESS_SCRIPTS[harnessId]);
  const parentEnv = options.parentEnv ?? process.env;
  const supabaseConfig = fetchLocalSupabaseConfig(options);

  let appUrl;
  if (APP_REQUIRED.has(harnessId)) {
    appUrl = options.appUrl ?? DEFAULT_APP_URL;
    validateLoopbackHttpUrl(appUrl, "APP_URL", 3100);
    loadHarnessConfigWithApp({
      SUPABASE_URL: supabaseConfig.supabaseUrl,
      SUPABASE_ANON_KEY: supabaseConfig.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseConfig.supabaseServiceRoleKey,
      APP_URL: appUrl,
    });
  } else {
    loadHarnessConfig({
      SUPABASE_URL: supabaseConfig.supabaseUrl,
      SUPABASE_ANON_KEY: supabaseConfig.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseConfig.supabaseServiceRoleKey,
    });
  }

  const spawnImpl = options.spawnImpl ?? spawnSync;
  const childEnv = buildChildEnv(supabaseConfig, appUrl, parentEnv);
  const result = spawnImpl(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    env: childEnv,
    encoding: "utf8",
    timeout: HARNESS_TIMEOUT_MS,
    shell: false,
    stdio: ["ignore", "inherit", "inherit"],
    killSignal: "SIGTERM",
  });

  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("harness-timeout");
  }
  if (result.signal) {
    throw new Error("harness-signal-terminated");
  }
  if (result.error) {
    throw new Error("harness-spawn-failed");
  }
  return result.status ?? 1;
}

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

function main() {
  const parsed = parseWrapperArgs(process.argv);
  if ("error" in parsed) {
    console.error(`run-local-harness: ${parsed.error}`);
    process.exit(1);
  }

  const { harnessId, appUrl } = parsed;
  try {
    console.log("run-local-harness: starting harness");
    const code = runHarness(harnessId, { appUrl });
    if (code === 0) {
      console.log("run-local-harness: harness completed");
    } else {
      console.error("run-local-harness: harness-exit-nonzero");
    }
    process.exit(code);
  } catch (err) {
    console.error(`run-local-harness: ${mapWrapperError(err)}`);
    process.exit(1);
  }
}

if (isDirectExecution()) {
  main();
}
