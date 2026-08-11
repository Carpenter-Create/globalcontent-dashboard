import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  resolveBinary,
  assertCompatibleBinary,
  generateSyntheticCredential,
  sanitizeFindings,
  scanFileNoGit,
  runCanary,
  runScan,
  executeScanCommand,
  interpretScanResult,
  parseReportFile,
  printScanResult,
  finalizeScanResult,
  sanitizeFindingForLog,
  sanitizeLogScalar,
  ScanOutcome,
  GITLEAKS_VERSION,
  REPO_ROOT,
} from "./scan-secrets.mjs";

const GITLEAKS_BIN = process.env.GITLEAKS_BIN ?? resolveBinary();

function gitleaksAvailable() {
  try {
    assertCompatibleBinary(GITLEAKS_BIN);
    return true;
  } catch {
    return false;
  }
}

const hasGitleaks = gitleaksAvailable();

function assertOutsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  assert.ok(rel.startsWith(".."), "fixture must live outside repository root");
}

/**
 * @param {string} dir
 * @param {string} scriptBody
 */
function writeFakeScanner(dir, scriptBody) {
  assertOutsideRepo(dir);
  const bin = join(dir, "fake-gitleaks");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
set -euo pipefail
${scriptBody}
`,
    "utf8",
  );
  chmodSync(bin, 0o755);
  return bin;
}

function spawnResult(overrides) {
  return {
    status: 0,
    signal: null,
    stdout: "",
    stderr: "",
    error: undefined,
    ...overrides,
  };
}

describe("binary resolution", () => {
  it("rejects unavailable binary", () => {
    assert.throws(() => assertCompatibleBinary("/nonexistent/scanner"), /unavailable/);
  });

  it("rejects disqualified v8.30.1 via controlled fake binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-version-"));
    try {
      const bin = writeFakeScanner(
        dir,
        'echo "gitleaks version 8.30.1"',
      );
      assert.throws(() => assertCompatibleBinary(bin), /disqualified/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects version mismatch via controlled fake binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-version-"));
    try {
      const bin = writeFakeScanner(
        dir,
        'echo "gitleaks version 8.29.0"',
      );
      assert.throws(() => assertCompatibleBinary(bin), /mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scan result contract", () => {
  const operationalCategories = [
    "scanner-nonzero-status",
    "scanner-timeout",
    "scanner-signal-terminated",
    "scanner-spawn-failed",
    "scanner-null-status",
    "scanner-buffer-exhausted",
    "report-missing",
    "report-malformed-json",
    "report-unexpected-schema",
    "scanner-status-report-mismatch",
    "scanner-exit-findings-without-report",
  ];

  for (const category of operationalCategories) {
    it(`operational ${category} has leaked=null`, () => {
      const finalized = finalizeScanResult({
        outcome: ScanOutcome.OPERATIONAL_ERROR,
        category,
        findings: [],
      });
      assert.equal(finalized.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(finalized.leaked, null);
      assert.notEqual(finalized.leaked, false);
    });
  }

  it("clean outcome has leaked=false", () => {
    const finalized = finalizeScanResult({
      outcome: ScanOutcome.CLEAN,
      category: "clean",
      findings: [],
    });
    assert.equal(finalized.leaked, false);
  });

  it("findings outcome has leaked=true", () => {
    const finalized = finalizeScanResult({
      outcome: ScanOutcome.FINDINGS,
      category: "findings",
      findings: [{ RuleID: "jwt", File: "x.txt", StartLine: 1 }],
    });
    assert.equal(finalized.leaked, true);
  });
});

describe("finding metadata log safety", () => {
  it("strips control characters and ANSI from logged metadata", () => {
    const malicious = {
      RuleID: "jwt\u001b[31mINJECT",
      File: "ok.txt\r\nINJECTED-LINE",
      StartLine: 1,
    };
    const sanitized = sanitizeFindingForLog(malicious);
    assert.equal(sanitized.RuleID, "unknown");
    assert.equal(sanitized.File, "unknown");
    assert.equal(sanitized.StartLine, 1);
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      printScanResult({
        outcome: ScanOutcome.FINDINGS,
        findings: [malicious],
      });
      const joined = logs.join("\n");
      assert.equal(joined.includes("INJECTED-LINE"), false);
      assert.equal(joined.includes("\u001b[31m"), false);
      assert.equal(logs.length, 2);
    } finally {
      console.error = originalError;
    }
  });
});

const SCAN_SOURCE = join(REPO_ROOT, "scripts/governance/scan-secrets.mjs");
const PERMISSIVE_SCALAR_RE = /^[\s\S]+$/;

/**
 * @param {typeof sanitizeLogScalar} sanitizeImpl
 */
function assertConsecutiveControlScalarProbe(sanitizeImpl) {
  sanitizeImpl("a\u001b[0m", PERMISSIVE_SCALAR_RE, "unknown");
  assert.equal(sanitizeImpl("\u2028INJECT", PERMISSIVE_SCALAR_RE, "unknown"), "unknown");
}

describe("stateless control-character sanitization", () => {
  const RULE_INJECT = "jwt\u001b[31mRULE-INJECT";
  const PATH_INJECT = "ok.txt\r\nPATH-INJECT";

  it("rejects consecutive unsafe RuleID and File without printed leakage", () => {
    const malicious = {
      RuleID: RULE_INJECT,
      File: PATH_INJECT,
      StartLine: 1,
    };
    const sanitized = sanitizeFindingForLog(malicious);
    assert.equal(sanitized.RuleID, "unknown");
    assert.equal(sanitized.File, "unknown");

    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      printScanResult({
        outcome: ScanOutcome.FINDINGS,
        findings: [malicious],
      });
      const joined = logs.join("\n");
      assert.equal(joined.includes("RULE-INJECT"), false);
      assert.equal(joined.includes("PATH-INJECT"), false);
      assert.equal(joined.includes("\u001b[31m"), false);
      assert.equal(joined.includes("\r\n"), false);
    } finally {
      console.error = originalError;
    }
  });

  it("alternates safe and unsafe fields across repeated sanitization calls", () => {
    const sequences = [
      { RuleID: RULE_INJECT, File: "safe.txt", expectRule: "unknown", expectFile: "safe.txt" },
      { RuleID: "github-pat", File: PATH_INJECT, expectRule: "github-pat", expectFile: "unknown" },
      { RuleID: "safe-rule", File: "safe.txt", expectRule: "safe-rule", expectFile: "safe.txt" },
      { RuleID: RULE_INJECT, File: PATH_INJECT, expectRule: "unknown", expectFile: "unknown" },
      { RuleID: "jwt", File: "a.txt\u2028tail", expectRule: "jwt", expectFile: "unknown" },
    ];
    for (const entry of sequences) {
      const sanitized = sanitizeFindingForLog({
        RuleID: entry.RuleID,
        File: entry.File,
        StartLine: 1,
      });
      assert.equal(sanitized.RuleID, entry.expectRule);
      assert.equal(sanitized.File, entry.expectFile);
    }
  });

  it("consecutive control-character probe stays deterministic across repeated calls", () => {
    for (let i = 0; i < 5; i++) {
      assertConsecutiveControlScalarProbe(sanitizeLogScalar);
    }
  });

  it("mutation restoring global regex flag reintroduces cross-call control detection miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-secrets-mut-"));
    try {
      assertOutsideRepo(dir);
      const copyPath = join(dir, "scan-secrets.mjs");
      writeFileSync(
        copyPath,
        readFileSync(SCAN_SOURCE, "utf8").replace("[@-~]/;", "[@-~]/g;"),
      );
      const mod = await import(`${pathToFileURL(copyPath).href}?t=${Date.now()}`);
      assert.throws(() => assertConsecutiveControlScalarProbe(mod.sanitizeLogScalar));
      assert.notEqual(
        (() => {
          mod.sanitizeLogScalar("a\u001b[0m", PERMISSIVE_SCALAR_RE, "unknown");
          return mod.sanitizeLogScalar("\u2028INJECT", PERMISSIVE_SCALAR_RE, "unknown");
        })(),
        "unknown",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("temporary directory cleanup", () => {
  it("scanFileNoGit removes temp dir when initial write fails", () => {
    const before = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith("gitleaks-file-")),
    );
    assert.throws(
      () =>
        scanFileNoGit(
          "/bin/true",
          REPO_ROOT,
          "canary.txt",
          "x",
          join(REPO_ROOT, ".gitleaks.toml"),
          {
            skipVersionCheck: true,
            writeFileSyncImpl: () => {
              throw new Error("write failed");
            },
          },
        ),
      /write failed/,
    );
    const after = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith("gitleaks-file-")),
    );
    assert.deepEqual(after, before);
  });

  it("runScan removes temp dir when spawn fails", () => {
    const before = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith("gitleaks-report-")),
    );
    const result = runScan(
      "/bin/false",
      REPO_ROOT,
      "staged",
      join(REPO_ROOT, ".gitleaks.toml"),
      {
        skipVersionCheck: true,
        spawnImpl: () => ({ status: 2, stdout: "", stderr: "" }),
      },
    );
    assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
    assert.equal(result.leaked, null);
    const after = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith("gitleaks-report-")),
    );
    assert.deepEqual(after, before);
  });
});

describe("sanitized findings", () => {
  it("removes secret material from report shape", () => {
    const sanitized = sanitizeFindings([
      {
        RuleID: "github-pat",
        File: "x.txt",
        StartLine: 1,
        Secret: "ghp_supersecret",
        Match: "ghp_supersecret",
      },
    ]);
    assert.equal(sanitized[0].RuleID, "github-pat");
    assert.equal(sanitized[0].File, "x.txt");
    assert.equal(sanitized[0].StartLine, 1);
    assert.equal(JSON.stringify(sanitized).includes("ghp_supersecret"), false);
  });
});

describe("interpretScanResult fail-closed semantics", () => {
  it("exit 2 is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const result = interpretScanResult(spawnResult({ status: 2 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.findings.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("status null is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const result = interpretScanResult(spawnResult({ status: null }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-null-status");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spawn failure is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const result = interpretScanResult(
        spawnResult({ error: new Error("spawn failed"), status: null }),
        reportPath,
      );
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-spawn-failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("timeout is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const err = new Error("timeout");
      err.code = "ETIMEDOUT";
      const result = interpretScanResult(
        spawnResult({ error: err, status: null }),
        reportPath,
      );
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-timeout");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("signal termination is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const result = interpretScanResult(
        spawnResult({ signal: "SIGTERM", status: null }),
        reportPath,
      );
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-signal-terminated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buffer exhaustion is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      const err = new Error("maxBuffer");
      err.code = "ENOBUFS";
      const result = interpretScanResult(
        spawnResult({ error: err, status: null }),
        reportPath,
      );
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-buffer-exhausted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 0 with missing report is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "missing.json");
    try {
      const result = interpretScanResult(spawnResult({ status: 0 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "report-missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 0 with malformed JSON is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(reportPath, "{not-json");
      const result = interpretScanResult(spawnResult({ status: 0 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "report-malformed-json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 0 with unexpected schema is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(reportPath, JSON.stringify({ RuleID: "x" }));
      const result = interpretScanResult(spawnResult({ status: 0 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "report-unexpected-schema");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 1 with missing report is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "missing.json");
    try {
      const result = interpretScanResult(spawnResult({ status: 1 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "report-missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 1 with empty findings report is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(reportPath, "[]");
      const result = interpretScanResult(spawnResult({ status: 1 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-exit-findings-without-report");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 0 with nonempty report is operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(
        reportPath,
        JSON.stringify([{ RuleID: "jwt", File: "x.txt", StartLine: 1 }]),
      );
      const result = interpretScanResult(spawnResult({ status: 0 }), reportPath);
      assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(result.category, "scanner-status-report-mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("valid exit 0 with empty report is clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(reportPath, "[]");
      const result = finalizeScanResult(interpretScanResult(spawnResult({ status: 0 }), reportPath));
      assert.equal(result.outcome, ScanOutcome.CLEAN);
      assert.equal(result.leaked, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("valid exit 1 with finding report is findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(
        reportPath,
        JSON.stringify([{ RuleID: "jwt", File: "x.txt", StartLine: 2 }]),
      );
      const result = finalizeScanResult(interpretScanResult(spawnResult({ status: 1 }), reportPath));
      assert.equal(result.outcome, ScanOutcome.FINDINGS);
      assert.equal(result.leaked, true);
      assert.equal(result.findings.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [label, spawn] of [
    ["exit 2", { status: 2 }],
    ["timeout", { error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }), status: null }],
    ["signal", { signal: "SIGTERM", status: null }],
    ["buffer exhaustion", { error: Object.assign(new Error("b"), { code: "ENOBUFS" }), status: null }],
  ]) {
    it(`operational family ${label} never sets leaked=false`, () => {
      const dir = mkdtempSync(join(tmpdir(), "gl-report-"));
      const reportPath = join(dir, "report.json");
      try {
        writeFileSync(reportPath, "[]");
        const result = finalizeScanResult(interpretScanResult(spawnResult(spawn), reportPath));
        assert.equal(result.outcome, ScanOutcome.OPERATIONAL_ERROR);
        assert.equal(result.leaked, null);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("executeScanCommand with fake scanner executables", () => {
  it("fake scanner exit 2 yields operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-fake-"));
    const reportPath = join(dir, "report.json");
    try {
      const bin = writeFakeScanner(dir, "exit 2");
      const result = executeScanCommand({
        bin,
        args: [],
        cwd: dir,
        reportPath,
      });
      assert.equal(finalizeScanResult(result).outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(finalizeScanResult(result).leaked, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fake scanner exit 0 without report yields operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-fake-"));
    const reportPath = join(dir, "report.json");
    try {
      const bin = writeFakeScanner(dir, "exit 0");
      const result = executeScanCommand({
        bin,
        args: [],
        cwd: dir,
        reportPath,
      });
      assert.equal(finalizeScanResult(result).outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(finalizeScanResult(result).leaked, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fake scanner writes valid clean report on exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-fake-"));
    const reportPath = join(dir, "report.json");
    try {
      const bin = writeFakeScanner(
        dir,
        `echo '[]' > "$REPORT_PATH"
exit 0`,
      );
      const result = executeScanCommand({
        bin,
        args: [],
        cwd: dir,
        reportPath,
        spawnImpl: (b, a, o) => {
          const env = { ...process.env, REPORT_PATH: reportPath };
          return spawnSync(b, a, { ...o, env });
        },
      });
      const finalized = finalizeScanResult(result);
      assert.equal(finalized.outcome, ScanOutcome.CLEAN);
      assert.equal(finalized.leaked, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fake scanner malformed report with exit 0 is operational via child", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-fake-mal-"));
    try {
      const bin = writeFakeScanner(
        dir,
        `echo '{bad-json' > "$REPORT_PATH"
exit 0`,
      );
      const reportPath = join(dir, "report.json");
      const result = executeScanCommand({
        bin,
        args: [],
        cwd: dir,
        reportPath,
        spawnImpl: (b, a, o) => {
          const env = { ...process.env, REPORT_PATH: reportPath };
          return spawnSync(b, a, { ...o, env });
        },
      });
      const finalized = finalizeScanResult(result);
      assert.equal(finalized.outcome, ScanOutcome.OPERATIONAL_ERROR);
      assert.equal(finalized.leaked, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sanitized CLI output", () => {
  it("operational error output does not include raw scanner text", () => {
    const secret = "ghp_RAW_STDOUT_LEAK_0123456789abcdef";
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const code = printScanResult({
        outcome: ScanOutcome.OPERATIONAL_ERROR,
        category: "scanner-spawn-failed",
        findings: [],
      });
      assert.equal(code, 2);
      const joined = logs.join("\n");
      assert.match(joined, /operational error/);
      assert.equal(joined.includes(secret), false);
      assert.equal(joined.includes("spawn failed"), false);
    } finally {
      console.error = originalError;
    }
  });

  it("never prints clean after operational failure", () => {
    const logs = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args) => logs.push(args.join(" "));
    console.log = (...args) => logs.push(args.join(" "));
    try {
      printScanResult({
        outcome: ScanOutcome.OPERATIONAL_ERROR,
        category: "report-missing",
        findings: [],
      });
      assert.equal(logs.some((l) => /clean/i.test(l)), false);
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
  });
});

describe("scanner canary and boundaries", { skip: !hasGitleaks }, () => {
  const configPath = join(REPO_ROOT, ".gitleaks.toml");

  it("detects runtime synthetic credential", () => {
    const secret = generateSyntheticCredential();
    const result = scanFileNoGit(
      GITLEAKS_BIN,
      REPO_ROOT,
      "canary.txt",
      `token=${secret}\n`,
      configPath,
      { skipVersionCheck: false },
    );
    assert.equal(result.leaked, true);
    assert.equal(JSON.stringify(result.findings).includes(secret), false);
  });

  it("placeholder .env.example passes", () => {
    const result = scanFileNoGit(
      GITLEAKS_BIN,
      REPO_ROOT,
      ".env.example",
      "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key\n",
      configPath,
    );
    assert.equal(result.leaked, false);
    assert.equal(result.outcome, ScanOutcome.CLEAN);
  });

  it("synthetic .env.example with credential fails", () => {
    const secret = generateSyntheticCredential();
    const result = scanFileNoGit(
      GITLEAKS_BIN,
      REPO_ROOT,
      ".env.example",
      `API_KEY=${secret}\n`,
      configPath,
    );
    assert.equal(result.leaked, true);
  });

  it("runCanary passes end-to-end", () => {
    runCanary(GITLEAKS_BIN, REPO_ROOT);
  });

  it("canary fails closed when scanner returns operational error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-canary-"));
    try {
      const bin = writeFakeScanner(dir, 'echo "gitleaks version 8.30.0"\nexit 0');
      assert.throws(() => runCanary(bin, REPO_ROOT, { skipVersionCheck: true }), /canary|detect|missed|positive/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects secret committed then removed in temporary repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-git-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, ".gitleaks.toml"), readFileSync(join(REPO_ROOT, ".gitleaks.toml")));
      const secret = generateSyntheticCredential();
      writeFileSync(join(dir, "secret.txt"), secret + "\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "add secret"], { cwd: dir });
      writeFileSync(join(dir, "secret.txt"), "clean\n");
      execFileSync("git", ["add", "secret.txt"], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "remove secret"], { cwd: dir });
      const { leaked, outcome } = runScan(GITLEAKS_BIN, dir, "full-history", join(dir, ".gitleaks.toml"));
      assert.equal(leaked, true);
      assert.equal(outcome, ScanOutcome.FINDINGS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects secret present only in staged index", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-staged-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, ".gitleaks.toml"), readFileSync(join(REPO_ROOT, ".gitleaks.toml")));
      writeFileSync(join(dir, "README.md"), "# ok\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      const secret = generateSyntheticCredential();
      writeFileSync(join(dir, "staged.txt"), secret + "\n");
      execFileSync("git", ["add", "staged.txt"], { cwd: dir });
      const { leaked } = runScan(GITLEAKS_BIN, dir, "staged", join(dir, ".gitleaks.toml"));
      assert.equal(leaked, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("broken scanner fails canary closed", () => {
    assert.throws(() => runCanary("/bin/false", REPO_ROOT), /unavailable|mismatch|disqualified|canary/i);
  });
});

describe("repository staged scan", { skip: !hasGitleaks }, () => {
  it("real repository staged scan is clean", () => {
    const { leaked, outcome } = runScan(
      GITLEAKS_BIN,
      REPO_ROOT,
      "staged",
      join(REPO_ROOT, ".gitleaks.toml"),
    );
    assert.equal(leaked, false);
    assert.equal(outcome, ScanOutcome.CLEAN);
  });
});

describe("parseReportFile", () => {
  it("accepts Line alias for StartLine", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-parse-"));
    const reportPath = join(dir, "report.json");
    try {
      writeFileSync(
        reportPath,
        JSON.stringify([{ RuleID: "jwt", File: "a.txt", Line: 3 }]),
      );
      const parsed = parseReportFile(reportPath);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.findings[0].StartLine, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
