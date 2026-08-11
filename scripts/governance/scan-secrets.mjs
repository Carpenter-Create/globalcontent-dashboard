#!/usr/bin/env node
/**
 * Thin Gitleaks adapter — pinned version, sanitized output, Git-boundary scans only.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../..");

export const GITLEAKS_VERSION = "8.30.0";
export const DISALLOWED_VERSIONS = new Set(["8.30.1"]);
export const GITLEAKS_LINUX_ASSET = `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;
export const GITLEAKS_LINUX_SHA256 =
  "79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e";

export const SCAN_TIMEOUT_MS = 300_000;
export const SCAN_MAX_BUFFER = 8 * 1024 * 1024;

export const ScanOutcome = Object.freeze({
  CLEAN: "clean",
  FINDINGS: "findings",
  OPERATIONAL_ERROR: "operational_error",
});

const CONTROL_AND_ESCAPE_RE =
  /[\u0000-\u001F\u007F-\u009F]|\u2028|\u2029|\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const SAFE_RULE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._/@+-]{1,256}$/;

/**
 * @param {string | undefined} explicit
 */
export function resolveBinary(explicit) {
  const fromEnv = explicit ?? process.env.GITLEAKS_BIN;
  if (fromEnv) return fromEnv;
  return "gitleaks";
}

/**
 * @param {string} bin
 * @param {{ spawnImpl?: typeof spawnSync }} [options]
 */
export function getBinaryVersion(bin, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const result = spawnImpl(bin, ["version"], { encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0) {
    throw new Error("gitleaks-binary-unavailable");
  }
  const match = (result.stdout || result.stderr || "").match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    throw new Error("gitleaks-version-unparseable");
  }
  return match[1];
}

/**
 * @param {string} bin
 * @param {{ spawnImpl?: typeof spawnSync }} [options]
 */
export function assertCompatibleBinary(bin, options = {}) {
  const version = getBinaryVersion(bin, options);
  if (DISALLOWED_VERSIONS.has(version)) {
    throw new Error("gitleaks-version-disqualified");
  }
  if (version !== GITLEAKS_VERSION) {
    throw new Error("gitleaks-version-mismatch");
  }
  return version;
}

/**
 * @returns {string}
 */
export function generateSyntheticCredential() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(40);
  let token = "ghp_";
  for (let i = 0; i < 36; i++) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return token;
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @param {string} fallback
 */
export function sanitizeLogScalar(value, pattern, fallback) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }
  const original = String(value);
  if (CONTROL_AND_ESCAPE_RE.test(original)) {
    return fallback;
  }
  if (!original || !pattern.test(original)) {
    return fallback;
  }
  return original;
}

/**
 * @param {{ RuleID?: unknown, File?: unknown, StartLine?: unknown, Line?: unknown }} finding
 */
export function sanitizeFindingForLog(finding) {
  const rawLine = finding.StartLine ?? finding.Line;
  let line = 0;
  if (typeof rawLine === "number" && Number.isFinite(rawLine)) {
    const rounded = Math.trunc(rawLine);
    if (rounded > 0 && rounded <= 99_999_999) {
      line = rounded;
    }
  }
  return {
    RuleID: sanitizeLogScalar(finding.RuleID, SAFE_RULE_ID_RE, "unknown"),
    File: sanitizeLogScalar(finding.File, SAFE_PATH_RE, "unknown"),
    StartLine: line,
  };
}

/**
 * @param {unknown[]} findings
 */
export function sanitizeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.map((raw) => sanitizeFindingForLog(/** @type {Record<string, unknown>} */ (raw)));
}

/**
 * @param {{ outcome: string, category?: string, findings?: unknown[] }} result
 */
export function finalizeScanResult(result) {
  if (result.outcome === ScanOutcome.CLEAN) {
    return { ...result, leaked: false };
  }
  if (result.outcome === ScanOutcome.FINDINGS) {
    return { ...result, leaked: true };
  }
  return { ...result, leaked: null };
}

/**
 * @param {string} reportPath
 */
export function parseReportFile(reportPath) {
  if (!existsSync(reportPath)) {
    return { ok: false, category: "report-missing" };
  }
  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    return { ok: false, category: "report-unreadable" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, category: "report-malformed-json" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, category: "report-unexpected-schema" };
  }
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, category: "report-unexpected-schema" };
    }
    const row = /** @type {Record<string, unknown>} */ (item);
    if (typeof row.RuleID !== "string" || typeof row.File !== "string") {
      return { ok: false, category: "report-unexpected-schema" };
    }
    if (typeof row.StartLine !== "number" && typeof row.Line !== "number") {
      return { ok: false, category: "report-unexpected-schema" };
    }
  }
  return { ok: true, findings: sanitizeFindings(parsed) };
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 */
export function classifySpawnFailure(result) {
  if (result.error?.code === "ETIMEDOUT") return "scanner-timeout";
  if (result.error?.code === "ENOBUFS") return "scanner-buffer-exhausted";
  if (result.error) return "scanner-spawn-failed";
  if (result.signal) return "scanner-signal-terminated";
  if (result.status === null) return "scanner-null-status";
  return null;
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 * @param {string} reportPath
 */
export function interpretScanResult(result, reportPath) {
  const spawnCategory = classifySpawnFailure(result);
  if (spawnCategory) {
    return { outcome: ScanOutcome.OPERATIONAL_ERROR, category: spawnCategory, findings: [] };
  }

  const status = result.status;
  if (status !== 0 && status !== 1) {
    return { outcome: ScanOutcome.OPERATIONAL_ERROR, category: "scanner-nonzero-status", findings: [] };
  }

  const report = parseReportFile(reportPath);
  if (!report.ok) {
    return {
      outcome: ScanOutcome.OPERATIONAL_ERROR,
      category: report.category,
      findings: [],
    };
  }

  const findings = report.findings ?? [];
  if (status === 0) {
    if (findings.length > 0) {
      return {
        outcome: ScanOutcome.OPERATIONAL_ERROR,
        category: "scanner-status-report-mismatch",
        findings: [],
      };
    }
    return { outcome: ScanOutcome.CLEAN, category: "clean", findings: [] };
  }

  if (findings.length === 0) {
    return {
      outcome: ScanOutcome.OPERATIONAL_ERROR,
      category: "scanner-exit-findings-without-report",
      findings: [],
    };
  }
  return { outcome: ScanOutcome.FINDINGS, category: "findings", findings };
}

/**
 * @param {object} params
 */
export function executeScanCommand(params) {
  const {
    bin,
    args,
    cwd,
    reportPath,
    spawnImpl = spawnSync,
    timeoutMs = SCAN_TIMEOUT_MS,
    maxBuffer = SCAN_MAX_BUFFER,
  } = params;

  const result = spawnImpl(bin, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer,
    shell: false,
    killSignal: "SIGTERM",
  });

  return interpretScanResult(result, reportPath);
}

/**
 * @param {string} tmpDir
 */
export function removeTempDir(tmpDir) {
  rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * @param {string} bin
 * @param {string} repoRoot
 * @param {"staged" | "full-history"} mode
 * @param {string} configPath
 * @param {{ spawnImpl?: typeof spawnSync, skipVersionCheck?: boolean, writeFileSyncImpl?: typeof writeFileSync }} [options]
 */
export function runScan(bin, repoRoot, mode, configPath, options = {}) {
  if (!options.skipVersionCheck) {
    assertCompatibleBinary(bin, options);
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "gitleaks-report-"));
  try {
    const reportPath = join(tmpDir, "report.json");
    const command = mode === "staged" ? "protect" : "detect";
    const args = [
      command,
      "--config",
      configPath,
      "--report-format",
      "json",
      "--report-path",
      reportPath,
      "--exit-code",
      "1",
      "--redact",
      "--no-banner",
      "--log-level",
      "error",
    ];
    if (mode === "staged") {
      args.push("--staged");
    }
    args.push("--source", repoRoot);

    const result = executeScanCommand({
      bin,
      args,
      cwd: repoRoot,
      reportPath,
      spawnImpl: options.spawnImpl,
    });
    return finalizeScanResult(result);
  } finally {
    removeTempDir(tmpDir);
  }
}

/**
 * @param {string} bin
 * @param {string} dir
 * @param {string} filename
 * @param {string} content
 * @param {string} configPath
 * @param {{ spawnImpl?: typeof spawnSync, skipVersionCheck?: boolean, writeFileSyncImpl?: typeof writeFileSync }} [options]
 */
export function scanFileNoGit(bin, dir, filename, content, configPath, options = {}) {
  if (!options.skipVersionCheck) {
    assertCompatibleBinary(bin, options);
  }
  const writeImpl = options.writeFileSyncImpl ?? writeFileSync;
  const tmpDir = mkdtempSync(join(tmpdir(), "gitleaks-file-"));
  try {
    const filePath = join(tmpDir, filename);
    const reportPath = join(tmpDir, "report.json");
    writeImpl(filePath, content, "utf8");
    const args = [
      "detect",
      "--no-git",
      "--source",
      filePath,
      "--config",
      configPath,
      "--report-format",
      "json",
      "--report-path",
      reportPath,
      "--exit-code",
      "1",
      "--redact",
      "--no-banner",
      "--log-level",
      "error",
    ];
    const result = executeScanCommand({
      bin,
      args,
      cwd: tmpDir,
      reportPath,
      spawnImpl: options.spawnImpl,
    });
    return finalizeScanResult(result);
  } finally {
    removeTempDir(tmpDir);
  }
}

/**
 * @param {string} bin
 * @param {string} repoRoot
 * @param {{ spawnImpl?: typeof spawnSync }} [options]
 */
export function runCanary(bin, repoRoot = REPO_ROOT, options = {}) {
  assertCompatibleBinary(bin, options);
  const configPath = join(repoRoot, ".gitleaks.toml");
  const secret = generateSyntheticCredential();

  const positive = scanFileNoGit(
    bin,
    repoRoot,
    "canary.txt",
    `export TOKEN="${secret}"\n`,
    configPath,
    options,
  );
  if (positive.outcome !== ScanOutcome.FINDINGS) {
    throw new Error("scanner-canary-not-detected");
  }

  const serialized = JSON.stringify(positive.findings);
  if (serialized.includes(secret)) {
    throw new Error("scanner-canary-output-leak");
  }

  const placeholder = scanFileNoGit(
    bin,
    repoRoot,
    ".env.example",
    "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key\n",
    configPath,
    options,
  );
  if (placeholder.outcome !== ScanOutcome.CLEAN) {
    throw new Error("scanner-canary-placeholder-false-positive");
  }

  const negative = scanFileNoGit(
    bin,
    repoRoot,
    ".env.example",
    `SECRET=${secret}\n`,
    configPath,
    options,
  );
  if (negative.outcome !== ScanOutcome.FINDINGS) {
    throw new Error("scanner-canary-negative-missed");
  }

  return { ok: true };
}

/**
 * @param {{ outcome: string, category?: string, findings?: unknown[] }} result
 */
export function printScanResult(result, modeLabel = "scan") {
  if (result.outcome === ScanOutcome.CLEAN) {
    console.log(`secret scan (${modeLabel}): clean`);
    return 0;
  }
  if (result.outcome === ScanOutcome.FINDINGS) {
    const findings = result.findings ?? [];
    console.error(`secret scan: ${findings.length} finding(s)`);
    for (const raw of findings) {
      const f = sanitizeFindingForLog(/** @type {Record<string, unknown>} */ (raw));
      console.error(`  rule=${f.RuleID} path=${f.File} line=${f.StartLine}`);
    }
    return 1;
  }
  console.error(`secret scan: operational error (${result.category ?? "unknown"})`);
  return 2;
}

function parseArgs(argv) {
  let mode = "staged";
  let bin;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--mode" && argv[i + 1]) {
      mode = argv[++i];
    } else if (argv[i] === "--binary" && argv[i + 1]) {
      bin = argv[++i];
    } else if (argv[i] === "--canary") {
      mode = "canary";
    }
  }
  if (mode !== "staged" && mode !== "full-history" && mode !== "canary") {
    throw new Error("scanner-mode-invalid");
  }
  return { mode, bin: resolveBinary(bin) };
}

function main() {
  const { mode, bin } = parseArgs(process.argv);
  const configPath = join(REPO_ROOT, ".gitleaks.toml");

  if (mode === "canary") {
    runCanary(bin, REPO_ROOT);
    console.log("secret scan canary: passed");
    return;
  }

  const result = runScan(bin, REPO_ROOT, mode, configPath);
  process.exit(printScanResult(result, mode));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch {
    console.error("secret scan: operational error (scanner-startup-failed)");
    process.exit(2);
  }
}
