import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  HarnessConfigError,
  validateRequiredKey,
  validateLoopbackHttpUrl,
  loadHarnessConfig,
  loadHarnessConfigWithApp,
} from "./local-harness-config.mjs";
import {
  ALLOWED_HARNESS_IDS,
  resolveHarnessId,
  parseWrapperArgs,
  parseSupabaseStatusJson,
  fetchLocalSupabaseConfig,
  buildChildEnv,
  pickEnv,
  runHarness,
  isDirectExecution,
  HARNESS_SCRIPTS,
  SUPABASE_CLI_ENV_KEYS,
  HARNESS_CHILD_ENV_KEYS,
  DEFAULT_APP_URL,
  mapWrapperError,
} from "../run-local-harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CONFIG_SOURCE = join(__dirname, "local-harness-config.mjs");
const WRAPPER_SOURCE = join(__dirname, "../run-local-harness.mjs");

function assertOutsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  assert.ok(rel.startsWith(".."), "fixture root must be outside repository");
}

function synthKey(prefix = "k") {
  return prefix + randomBytes(12).toString("hex");
}

function validEnv(overrides = {}) {
  return {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: synthKey("anon-"),
    SUPABASE_SERVICE_ROLE_KEY: synthKey("service-"),
    APP_URL: "http://127.0.0.1:3100",
    ...overrides,
  };
}

/**
 * @param {string} sourcePath
 * @param {(source: string) => string} mutator
 */
async function withMutatedModule(sourcePath, mutator, fn) {
  const dir = mkdtempSync(join(tmpdir(), "harness-mut-"));
  try {
    assertOutsideRepo(dir);
    const base = sourcePath.endsWith("local-harness-config.mjs")
      ? "local-harness-config.mjs"
      : "run-local-harness.mjs";
    const copyPath = join(dir, base);
    writeFileSync(copyPath, mutator(readFileSync(sourcePath, "utf8")));
    if (base === "run-local-harness.mjs") {
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(join(dir, "lib/local-harness-config.mjs"), readFileSync(CONFIG_SOURCE, "utf8"));
      const mutated = readFileSync(copyPath, "utf8").replace(
        './lib/local-harness-config.mjs',
        './lib/local-harness-config.mjs',
      );
      writeFileSync(copyPath, mutated);
    }
    const mod = await import(`${pathToFileURL(copyPath).href}?t=${Date.now()}`);
    return await fn(mod, copyPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("validateRequiredKey", () => {
  it("rejects missing, empty, whitespace, multiline, and non-string values", () => {
    assert.throws(() => validateRequiredKey(undefined, "SUPABASE_ANON_KEY"), HarnessConfigError);
    assert.throws(() => validateRequiredKey("  x  ", "SUPABASE_ANON_KEY"), /surrounding-whitespace/);
    assert.throws(() => validateRequiredKey("", "SUPABASE_ANON_KEY"), /empty/);
    assert.throws(() => validateRequiredKey("a\nb", "SUPABASE_ANON_KEY"), /multiline/);
    assert.throws(() => validateRequiredKey(1, "SUPABASE_ANON_KEY"), /invalid-type/);
  });

  it("accepts nonempty single-line keys without semantic inspection", () => {
    const key = synthKey();
    assert.equal(validateRequiredKey(key, "SUPABASE_ANON_KEY"), key);
  });
});

describe("validateLoopbackHttpUrl", () => {
  it("accepts localhost, 127.0.0.1, and IPv6 loopback on required ports", () => {
    validateLoopbackHttpUrl("http://localhost:54321", "SUPABASE_URL", 54321);
    validateLoopbackHttpUrl("http://127.0.0.1:54321/", "SUPABASE_URL", 54321);
    validateLoopbackHttpUrl("http://[::1]:54321", "SUPABASE_URL", 54321);
    validateLoopbackHttpUrl("http://127.0.0.1:3100", "APP_URL", 3100);
  });

  it("rejects malformed, credential, scheme, host, port, path, query, and fragment variants", () => {
    const cases = [
      ["not-a-url", "malformed-url"],
      ["http://user:pass@127.0.0.1:54321", "embedded-credentials"],
      ["https://127.0.0.1:54321", "non-http-scheme"],
      ["http://example.com:54321", "nonloopback-host"],
      ["http://localhost.example.com:54321", "nonloopback-host"],
      ["http://10.0.0.1:54321", "nonloopback-host"],
      ["http://2130706433:54321", "nonloopback-host"],
      ["http://127.0.0.1:54322", "wrong-port"],
      ["http://127.0.0.1:54321/extra", "non-root-path"],
      ["http://127.0.0.1:54321?x=1", "query-not-allowed"],
      ["http://127.0.0.1:54321#x", "fragment-not-allowed"],
    ];
    for (const [url, category] of cases) {
      assert.throws(
        () => validateLoopbackHttpUrl(url, "SUPABASE_URL", 54321),
        (err) => err instanceof HarnessConfigError && err.category === category,
        url,
      );
    }
  });

  it("rejects alternative spellings even when URL parser canonicalizes them", () => {
    const rejected = [
      "http://127.1:54321",
      "http://0x7f000001:54321",
      "http://0177.0.0.1:54321",
      "http://127.000.000.001:54321",
      "http://localhost.:54321",
      "http://%31%32%37%2e%30%2e%30%2e%31:54321",
      "http://[0:0:0:0:0:0:0:1]:54321",
      "http://[::ffff:127.0.0.1]:54321",
    ];
    for (const url of rejected) {
      assert.throws(
        () => validateLoopbackHttpUrl(url, "SUPABASE_URL", 54321),
        HarnessConfigError,
        url,
      );
    }
  });

  it("does not include supplied values in errors", () => {
    const secretHost = "http://evil-hostname-SECRET-12345:54321";
    try {
      validateLoopbackHttpUrl(secretHost, "SUPABASE_URL", 54321);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof HarnessConfigError);
      assert.equal(String(err).includes("SECRET-12345"), false);
    }
  });
});

describe("loadHarnessConfig", () => {
  it("requires all Supabase variables", () => {
    assert.throws(() => loadHarnessConfig({}), HarnessConfigError);
    assert.throws(() => loadHarnessConfig(validEnv({ SUPABASE_ANON_KEY: undefined })), /SUPABASE_ANON_KEY/);
    assert.throws(
      () => loadHarnessConfig(validEnv({ SUPABASE_SERVICE_ROLE_KEY: "  " })),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("requires APP_URL only when loading with app", () => {
    const env = validEnv();
    delete env.APP_URL;
    assert.throws(() => loadHarnessConfigWithApp(env), /APP_URL/);
    assert.doesNotThrow(() => loadHarnessConfig(env));
  });
});

describe("pre-network ordering for harness scripts", () => {
  const harnesses = [
    "../b3-cross-org-isolation.mjs",
    "../c-group-1-auth-failures.mjs",
    "../client-asset-routes-cross-org.mjs",
    "../l7-chain-of-title-gate.mjs",
    "../portal-cross-org.mjs",
  ];

  for (const rel of harnesses) {
    it(`${rel} validates before createClient`, () => {
      const text = readFileSync(join(__dirname, rel), "utf8");
      const loadIdx = text.indexOf("loadHarnessConfig");
      const clientIdx = text.indexOf("createClient(");
      assert.ok(loadIdx >= 0 && clientIdx > loadIdx, "validation must precede client construction");
      assert.equal(text.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), false);
    });
  }
});

describe("parseWrapperArgs", () => {
  it("accepts five valid identifiers", () => {
    for (const id of ALLOWED_HARNESS_IDS) {
      const parsed = parseWrapperArgs(["node", "run-local-harness.mjs", id]);
      assert.equal(parsed.harnessId, id);
    }
  });

  it("rejects unknown identifier without echoing value", () => {
    const evil = "MALICIOUS-HARNESS-ID-VALUE";
    const parsed = parseWrapperArgs(["node", "run-local-harness.mjs", evil]);
    assert.equal(parsed.error, "harness-identifier-not-allowed");
    assert.equal(JSON.stringify(parsed).includes(evil), false);
  });

  it("rejects unknown flags and extra positional arguments", () => {
    assert.equal(parseWrapperArgs(["node", "x", "b3", "--evil"]).error, "unknown-argument");
    assert.equal(parseWrapperArgs(["node", "x", "--help"]).error, "unknown-flag");
    assert.equal(parseWrapperArgs(["node", "x"]).error, "missing-harness-identifier");
  });

  it("accepts --app-url only for client-assets and portal", () => {
    assert.equal(
      parseWrapperArgs(["node", "x", "b3", "--app-url", "http://127.0.0.1:3100"]).error,
      "app-url-not-supported",
    );
    const ok = parseWrapperArgs([
      "node",
      "x",
      "portal",
      "--app-url",
      "http://127.0.0.1:3100",
    ]);
    assert.equal(ok.harnessId, "portal");
    assert.equal(ok.appUrl, "http://127.0.0.1:3100");
  });

  it("rejects duplicate and missing app-url values", () => {
    assert.equal(
      parseWrapperArgs([
        "node",
        "x",
        "portal",
        "--app-url",
        "http://127.0.0.1:3100",
        "--app-url",
        "http://127.0.0.1:3100",
      ]).error,
      "duplicate-app-url",
    );
    assert.equal(parseWrapperArgs(["node", "x", "portal", "--app-url"]).error, "missing-app-url-value");
  });
});

describe("resolveHarnessId", () => {
  it("allows only five identifiers and rejects arbitrary paths", () => {
    assert.equal(ALLOWED_HARNESS_IDS.length, 5);
    assert.equal(resolveHarnessId("b3"), "scripts/security/b3-cross-org-isolation.mjs");
    assert.throws(() => resolveHarnessId("../evil.mjs"), /not-allowed/);
    assert.throws(() => resolveHarnessId("scripts/security/b3-cross-org-isolation.mjs"), /not-allowed/);
  });
});

describe("wrapper sanitization and child environment", () => {
  it("parses required Supabase status fields without forwarding raw CLI output", () => {
    const secret = synthKey("jwt-");
    const parsed = parseSupabaseStatusJson(
      JSON.stringify({
        API_URL: "http://127.0.0.1:54321",
        ANON_KEY: secret,
        SERVICE_ROLE_KEY: synthKey("svc-"),
      }),
    );
    assert.equal(parsed.supabaseUrl, "http://127.0.0.1:54321");
    assert.equal(parsed.supabaseAnonKey, secret);
  });

  it("sanitizes CLI parse failures", () => {
    assert.throws(() => parseSupabaseStatusJson("{"), /parse-failed/);
    assert.throws(
      () => parseSupabaseStatusJson(JSON.stringify({ API_URL: "http://127.0.0.1:54321" })),
      /missing-field/,
    );
  });

  it("never forwards raw CLI stdout through fetchLocalSupabaseConfig", () => {
    const secret = synthKey("raw-");
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const config = fetchLocalSupabaseConfig({
        spawnImpl: () => ({
          status: 0,
          stdout: JSON.stringify({
            API_URL: "http://127.0.0.1:54321",
            ANON_KEY: secret,
            SERVICE_ROLE_KEY: synthKey("svc-"),
          }),
          stderr: "",
        }),
      });
      assert.equal(config.supabaseAnonKey, secret);
      assert.equal(logs.some((l) => l.includes(secret)), false);
    } finally {
      console.log = originalLog;
    }
  });

  it("excludes unrelated sentinel from Supabase CLI child environment", () => {
    const parentEnv = { ...process.env, __SENTINEL_UNRELATED__: "must-not-leak" };
    for (const key of SUPABASE_CLI_ENV_KEYS) {
      if (process.env[key] !== undefined) parentEnv[key] = process.env[key];
    }
    fetchLocalSupabaseConfig({
      parentEnv,
      spawnImpl: (_bin, _args, opts) => {
        assert.equal(opts.env.__SENTINEL_UNRELATED__, undefined);
        return {
          status: 0,
          stdout: JSON.stringify({
            API_URL: "http://127.0.0.1:54321",
            ANON_KEY: synthKey("a-"),
            SERVICE_ROLE_KEY: synthKey("s-"),
          }),
          stderr: "",
        };
      },
    });
  });

  it("excludes unrelated sentinel from harness child environment", () => {
    const parentEnv = { ...process.env, __SENTINEL_UNRELATED__: "must-not-leak", PATH: process.env.PATH };
    const config = {
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: synthKey("child-anon-"),
      supabaseServiceRoleKey: synthKey("child-svc-"),
    };
    const childEnv = buildChildEnv(config, DEFAULT_APP_URL, parentEnv);
    assert.equal(childEnv.__SENTINEL_UNRELATED__, undefined);
    assert.equal(childEnv.SUPABASE_URL, config.supabaseUrl);
  });

  it("pickEnv copies only allowlisted keys", () => {
    const env = pickEnv({ A: "1", B: "2", PATH: "/bin" }, ["PATH"]);
    assert.deepEqual(env, { PATH: "/bin" });
    assert.equal(Object.keys(env).length, 1);
  });

  it("fails closed on CLI timeout and spawn failure", () => {
    assert.throws(
      () =>
        fetchLocalSupabaseConfig({
          spawnImpl: () => ({ status: 1, stdout: "", stderr: "failed" }),
        }),
      /unavailable/,
    );
    assert.throws(
      () =>
        fetchLocalSupabaseConfig({
          spawnImpl: () => ({
            error: { code: "ETIMEDOUT" },
            status: null,
            stdout: "",
            stderr: "",
          }),
        }),
      /timeout/,
    );
  });

  it("mapWrapperError does not echo arbitrary Error.message", () => {
    const evil = "RAW-ERROR-MESSAGE-LEAK-98765";
    assert.equal(mapWrapperError(new Error(evil)), "wrapper-operational-error");
    assert.equal(mapWrapperError(new Error(evil)).includes(evil), false);
  });

  it("runHarness timeout and signal fail closed", () => {
    const baseSpawn = {
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: synthKey("a-"),
      supabaseServiceRoleKey: synthKey("s-"),
    };
    assert.throws(
      () =>
        runHarness("b3", {
          spawnImpl: (cmd, args) => {
            if (args.includes("status")) {
              return {
                status: 0,
                stdout: JSON.stringify({
                  API_URL: baseSpawn.supabaseUrl,
                  ANON_KEY: baseSpawn.supabaseAnonKey,
                  SERVICE_ROLE_KEY: baseSpawn.supabaseServiceRoleKey,
                }),
                stderr: "",
              };
            }
            return { error: { code: "ETIMEDOUT" }, status: null, stdout: "", stderr: "" };
          },
        }),
      /timeout/,
    );
    assert.throws(
      () =>
        runHarness("b3", {
          spawnImpl: (cmd, args) => {
            if (args.includes("status")) {
              return {
                status: 0,
                stdout: JSON.stringify({
                  API_URL: baseSpawn.supabaseUrl,
                  ANON_KEY: baseSpawn.supabaseAnonKey,
                  SERVICE_ROLE_KEY: baseSpawn.supabaseServiceRoleKey,
                }),
                stderr: "",
              };
            }
            return { signal: "SIGTERM", status: null, stdout: "", stderr: "" };
          },
        }),
      /signal/,
    );
  });

  it("valid five identifiers work through controlled fake harness child", () => {
    const keys = {
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: synthKey("a-"),
      SERVICE_ROLE_KEY: synthKey("s-"),
    };
    for (const id of ALLOWED_HARNESS_IDS) {
      const code = runHarness(id, {
        appUrl: DEFAULT_APP_URL,
        spawnImpl: (_cmd, args) => {
          if (args.includes("status")) {
            return { status: 0, stdout: JSON.stringify(keys), stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      });
      assert.equal(code, 0);
    }
  });
});

describe("wrapper process-boundary raw-output proof", () => {
  const HARNESS_EXECUTION_MARKER = "FAKE-HARNESS-EXECUTED-MARKER";
  const AMBIENT_SENTINEL_KEY = "__WRAPPER_TEST_AMBIENT_MUST_NOT_LEAK__";
  const NODE_EXECUTABLE = process.execPath;

  /**
   * @param {string} binDir
   * @param {string} ambientValue
   */
  function buildMinimalWrapperEnv(binDir, ambientValue) {
    return {
      PATH: binDir,
      [AMBIENT_SENTINEL_KEY]: ambientValue,
    };
  }

  /**
   * @param {string} fixtureRoot
   */
  function copyProductionWrapperFixture(fixtureRoot) {
    const securityDir = join(fixtureRoot, "scripts/security");
    const libDir = join(securityDir, "lib");
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(securityDir, "run-local-harness.mjs"), readFileSync(WRAPPER_SOURCE, "utf8"));
    writeFileSync(join(libDir, "local-harness-config.mjs"), readFileSync(CONFIG_SOURCE, "utf8"));
  }

  /**
   * @param {string} fixtureRoot
   * @param {string} [harnessId]
   */
  function writeFakeHarness(fixtureRoot, harnessId = "b3") {
    const scriptRel = HARNESS_SCRIPTS[harnessId];
    const harnessPath = join(fixtureRoot, scriptRel);
    mkdirSync(dirname(harnessPath), { recursive: true });
    writeFileSync(
      harnessPath,
      `#!/usr/bin/env node
if (process.env.${AMBIENT_SENTINEL_KEY}) {
  console.error("ambient-leaked-into-harness");
  process.exit(97);
}
console.log("${HARNESS_EXECUTION_MARKER}");
process.exit(0);
`,
      "utf8",
    );
    chmodSync(harnessPath, 0o755);
  }

  /**
   * @param {string} binDir
   * @param {string} scriptBody
   */
  function writeFakeSupabase(binDir, scriptBody) {
    const fakeSupabase = join(binDir, "supabase");
    writeFileSync(fakeSupabase, scriptBody, "utf8");
    chmodSync(fakeSupabase, 0o755);
    return fakeSupabase;
  }

  /**
   * @param {(ctx: {
   *   fixtureRoot: string,
   *   binDir: string,
   *   runCopiedWrapper: (args?: string[]) => import("node:child_process").SpawnSyncReturns<string>,
   * }) => void} fn
   */
  function withExternalWrapperFixture(fn) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "wrapper-fixture-"));
    try {
      assertOutsideRepo(fixtureRoot);
      const binDir = join(fixtureRoot, "bin");
      mkdirSync(binDir, { recursive: true });
      copyProductionWrapperFixture(fixtureRoot);
      writeFakeHarness(fixtureRoot);
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      const wrapperPath = realpathSync(join(fixtureRoot, "scripts/security/run-local-harness.mjs"));
      const runCopiedWrapper = (args = ["b3"]) =>
        spawnSync(NODE_EXECUTABLE, [wrapperPath, ...args], {
          cwd: fixtureRoot,
          env: buildMinimalWrapperEnv(binDir, ambientValue),
          encoding: "utf8",
          timeout: 15_000,
        });
      fn({ fixtureRoot, binDir, runCopiedWrapper });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }

  it("real copied wrapper executes fake harness without leaking supabase output", () => {
    withExternalWrapperFixture(({ binDir, runCopiedWrapper }) => {
      const stderrSentinel = `WRAPPER-RAW-OUTPUT-SENTINEL-${randomBytes(8).toString("hex")}`;
      const anon = synthKey("anon-");
      const svc = synthKey("svc-");
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
if [ -n "\${${AMBIENT_SENTINEL_KEY}:-}" ]; then
  echo "ambient-leaked-into-supabase" 1>&2
  exit 98
fi
echo "${stderrSentinel}" 1>&2
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${anon}","SERVICE_ROLE_KEY":"${svc}"}'
exit 0
`,
      );
      const result = runCopiedWrapper(["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(combined.includes(stderrSentinel), false);
      assert.equal(combined.includes(anon), false);
      assert.equal(combined.includes(svc), false);
      assert.equal(combined.includes("ambient-leaked-into-supabase"), false);
      assert.equal(combined.includes("ambient-leaked-into-harness"), false);
      assert.match(combined, new RegExp(HARNESS_EXECUTION_MARKER));
      assert.match(combined, /run-local-harness: harness completed/);
      assert.equal(result.status, 0);
    });
  });

  it("real copied wrapper fails closed without executing harness on malformed supabase output", () => {
    withExternalWrapperFixture(({ binDir, runCopiedWrapper }) => {
      const sentinel = `WRAPPER-FAIL-SENTINEL-${randomBytes(8).toString("hex")}`;
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
if [ -n "\${${AMBIENT_SENTINEL_KEY}:-}" ]; then
  echo "ambient-leaked-into-supabase" 1>&2
  exit 98
fi
echo "${sentinel}" 1>&2
echo "${sentinel}"
exit 0
`,
      );
      const result = runCopiedWrapper(["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(combined.includes(sentinel), false);
      assert.equal(combined.includes(HARNESS_EXECUTION_MARKER), false);
      assert.match(combined, /supabase-status-parse-failed|supabase-status-missing-field/);
      assert.notEqual(result.status, 0);
    });
  });

  it("restricted PATH prevents fallthrough to system supabase", () => {
    withExternalWrapperFixture(({ binDir, runCopiedWrapper }) => {
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const missing = join(binDir, "supabase-missing");
      rmSync(join(binDir, "supabase"), { force: true });
      const result = runCopiedWrapper(["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(combined.includes(HARNESS_EXECUTION_MARKER), false);
      assert.match(combined, /supabase-status-unavailable|wrapper-operational-error/);
      assert.notEqual(result.status, 0);
    });
  });

  /**
   * @param {string} fixtureRoot
   * @param {string} binDir
   * @param {string} ambientValue
   * @param {string[]} args
   * @param {string} [wrapperArg]
   */
  function runWrapperSubprocess(fixtureRoot, binDir, ambientValue, args, wrapperArg) {
    const entry =
      wrapperArg ?? join("scripts", "security", "run-local-harness.mjs");
    return spawnSync(NODE_EXECUTABLE, [entry, ...args], {
      cwd: fixtureRoot,
      env: buildMinimalWrapperEnv(binDir, ambientValue),
      encoding: "utf8",
      timeout: 15_000,
    });
  }

  it("relative-path CLI invocation enters main and executes harness (CI shape)", () => {
    withExternalWrapperFixture(({ fixtureRoot, binDir }) => {
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const result = runWrapperSubprocess(fixtureRoot, binDir, ambientValue, ["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.match(combined, new RegExp(HARNESS_EXECUTION_MARKER));
      assert.match(combined, /run-local-harness: harness completed/);
      assert.equal(result.status, 0);
    });
  });

  it("absolute-path CLI invocation enters main and executes harness", () => {
    withExternalWrapperFixture(({ fixtureRoot, binDir }) => {
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const wrapperPath = realpathSync(join(fixtureRoot, "scripts/security/run-local-harness.mjs"));
      const result = runWrapperSubprocess(fixtureRoot, binDir, ambientValue, ["b3"], wrapperPath);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.match(combined, new RegExp(HARNESS_EXECUTION_MARKER));
      assert.match(combined, /run-local-harness: harness completed/);
      assert.equal(result.status, 0);
    });
  });

  it("relative-path l7 invocation matches CI entry shape", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "wrapper-fixture-"));
    try {
      assertOutsideRepo(fixtureRoot);
      const binDir = join(fixtureRoot, "bin");
      mkdirSync(binDir, { recursive: true });
      copyProductionWrapperFixture(fixtureRoot);
      writeFakeHarness(fixtureRoot, "l7");
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const result = runWrapperSubprocess(fixtureRoot, binDir, ambientValue, ["l7"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.match(combined, new RegExp(HARNESS_EXECUTION_MARKER));
      assert.match(combined, /run-local-harness: harness completed/);
      assert.equal(result.status, 0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("relative-path CLI invocation with spaces in fixture path executes harness", () => {
    const parent = mkdtempSync(join(tmpdir(), "wrapper-parent-"));
    const fixtureRoot = join(parent, "fixture dir with spaces");
    mkdirSync(fixtureRoot, { recursive: true });
    try {
      assertOutsideRepo(fixtureRoot);
      const binDir = join(fixtureRoot, "bin");
      mkdirSync(binDir, { recursive: true });
      copyProductionWrapperFixture(fixtureRoot);
      writeFakeHarness(fixtureRoot, "b3");
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const result = runWrapperSubprocess(fixtureRoot, binDir, ambientValue, ["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.match(combined, new RegExp(HARNESS_EXECUTION_MARKER));
      assert.equal(result.status, 0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("importing copied wrapper module does not execute harness", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "wrapper-import-"));
    try {
      assertOutsideRepo(fixtureRoot);
      copyProductionWrapperFixture(fixtureRoot);
      writeFakeHarness(fixtureRoot, "b3");
      const wrapperUrl = pathToFileURL(
        join(fixtureRoot, "scripts/security/run-local-harness.mjs"),
      ).href;
      const mod = await import(`${wrapperUrl}?import=${Date.now()}`);
      assert.equal(typeof mod.runHarness, "function");
      assert.equal(typeof mod.isDirectExecution, "function");
      assert.equal(mod.isDirectExecution(), false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("legacy argv string equality diverges from normalized direct-execution check", () => {
    const modulePath = realpathSync(WRAPPER_SOURCE);
    const relativeEntry = join("scripts", "security", "run-local-harness.mjs");
    const previousCwd = process.cwd();
    try {
      process.chdir(REPO_ROOT);
      assert.equal(modulePath === relativeEntry, false);
      assert.equal(isDirectExecution(relativeEntry), true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("disabled direct-execution guard exits 0 without harness lifecycle evidence", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "wrapper-disabled-guard-"));
    try {
      assertOutsideRepo(fixtureRoot);
      const binDir = join(fixtureRoot, "bin");
      mkdirSync(binDir, { recursive: true });
      const securityDir = join(fixtureRoot, "scripts/security");
      const libDir = join(securityDir, "lib");
      mkdirSync(libDir, { recursive: true });
      const disabledGuardSource = readFileSync(WRAPPER_SOURCE, "utf8").replace(
        "if (isDirectExecution()) {",
        "if (false) {",
      );
      writeFileSync(join(securityDir, "run-local-harness.mjs"), disabledGuardSource);
      writeFileSync(join(libDir, "local-harness-config.mjs"), readFileSync(CONFIG_SOURCE, "utf8"));
      writeFakeHarness(fixtureRoot, "b3");
      writeFakeSupabase(
        binDir,
        `#!/bin/sh
printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"${synthKey("anon-")}","SERVICE_ROLE_KEY":"${synthKey("svc-")}"}'
exit 0
`,
      );
      const ambientValue = `ambient-${randomBytes(8).toString("hex")}`;
      const result = runWrapperSubprocess(fixtureRoot, binDir, ambientValue, ["b3"]);
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(combined.includes(HARNESS_EXECUTION_MARKER), false);
      assert.equal(combined.includes("run-local-harness: harness completed"), false);
      assert.equal(combined.includes("run-local-harness: starting harness"), false);
      assert.equal(result.status, 0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("isDirectExecution", () => {
  it("matches absolute and cwd-relative argv paths to the wrapper module", () => {
    const wrapperPath = realpathSync(WRAPPER_SOURCE);
    const relativeFromRepo = join("scripts", "security", "run-local-harness.mjs");
    const previousCwd = process.cwd();
    try {
      process.chdir(REPO_ROOT);
      assert.equal(isDirectExecution(wrapperPath), true);
      assert.equal(isDirectExecution(relativeFromRepo), true);
      assert.equal(isDirectExecution(join(REPO_ROOT, relativeFromRepo)), true);
      assert.equal(isDirectExecution(process.execPath), false);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("config validator mutation evidence via temporary copies", () => {
  it("hostname mutation accepting localhost.example.com fails when restored", async () => {
    await withMutatedModule(
      CONFIG_SOURCE,
      (source) =>
        source.replace(
          'if (!ALLOWED_AUTHORITIES.has(authority)) {',
          'if (!ALLOWED_AUTHORITIES.has(authority) && authority !== "localhost.example.com") {',
        ),
      async (mod) => {
        assert.doesNotThrow(() =>
          mod.validateLoopbackHttpUrl(
            "http://localhost.example.com:54321",
            "SUPABASE_URL",
            54321,
          ),
        );
      },
    );
    assert.throws(() =>
      validateLoopbackHttpUrl("http://localhost.example.com:54321", "SUPABASE_URL", 54321),
    );
  });

  it("bypassed required-key check fails missing-key test in copy", async () => {
    await withMutatedModule(
      CONFIG_SOURCE,
      (source) =>
        source.replace(
          "export function validateRequiredKey(value, name) {",
          "export function validateRequiredKey(value, name) { if (value === undefined || value === null) return 'bypass';",
        ),
      async (mod) => {
        assert.equal(mod.validateRequiredKey(undefined, "SUPABASE_ANON_KEY"), "bypass");
      },
    );
    assert.throws(() => validateRequiredKey(undefined, "SUPABASE_ANON_KEY"));
  });

  it("wrapper path mutation allows arbitrary identifier until original restored", async () => {
    await withMutatedModule(
      WRAPPER_SOURCE,
      (source) =>
        source.replace(
          "if (!ALLOWED_HARNESS_IDS.includes(id)) {",
          "if (false && !ALLOWED_HARNESS_IDS.includes(id)) {",
        ),
      async (mod) => {
        assert.doesNotThrow(() => mod.resolveHarnessId("not-allowed"));
      },
    );
    assert.throws(() => resolveHarnessId("not-allowed"));
  });

  it("validation moved after client construction fails ordering guard in copy", () => {
    const harnessPath = join(__dirname, "../b3-cross-org-isolation.mjs");
    const harnessOriginal = readFileSync(harnessPath, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "harness-order-mut-"));
    try {
      assertOutsideRepo(dir);
      const copyPath = join(dir, "b3-cross-org-isolation.mjs");
      const mutated = harnessOriginal.replace(
        /const \{ supabaseUrl: URL[\s\S]*?loadHarnessConfig\(process\.env\);\n\nconst admin = createClient/,
        "const admin = createClient",
      );
      writeFileSync(copyPath, mutated);
      const text = readFileSync(copyPath, "utf8");
      const loadLine = text.indexOf("loadHarnessConfig(process.env)");
      const clientLine = text.indexOf("const admin = createClient");
      assert.ok(clientLine >= 0);
      assert.ok(loadLine === -1 || clientLine < loadLine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("invalid config pre-network trap", () => {
  it("throws on invalid env without constructing clients", () => {
    assert.throws(() => loadHarnessConfig({}), (err) => err instanceof HarnessConfigError);
  });
});

describe("HARNESS_CHILD_ENV_KEYS allowlist", () => {
  it("documents operational keys only", () => {
    assert.deepEqual(HARNESS_CHILD_ENV_KEYS, ["PATH", "NODE_ENV", "TZ", "CI"]);
  });
});
