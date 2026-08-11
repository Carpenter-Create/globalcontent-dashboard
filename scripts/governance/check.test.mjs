import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  checkAgents,
  checkClaude,
  checkCurrent,
  checkCurrentLine,
  checkCursorRules,
  checkDocumentLinks,
  checkLegacyBanners,
  checkTopBanner,
  checkInlineGitleaksAllow,
  classifyDocLink,
  inlineAllowDirectivePattern,
  countWords,
  CLAUDE_EXPECTED,
  APPROVED_CURSOR_RULES,
  runAllChecks,
  REPO_ROOT,
} from "./check.mjs";

const CHECK_SOURCE = join(REPO_ROOT, "scripts/governance/check.mjs");

function words(n) {
  const base = "word ";
  let text = "# Title\n\n";
  while (countWords(text) < n) text += base;
  return text.trimEnd() + "\n";
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "gov-fixture-"));
  try {
    assertOutsideRepo(dir);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertOutsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  assert.ok(rel.startsWith(".."), "fixture root must be outside repository");
}

/**
 * @param {(source: string) => string} mutator
 */
async function withMutatedCheckModule(mutator, fn) {
  const dir = mkdtempSync(join(tmpdir(), "gov-mut-"));
  try {
    assertOutsideRepo(dir);
    const copyPath = join(dir, "check.mjs");
    writeFileSync(copyPath, mutator(readFileSync(CHECK_SOURCE, "utf8")));
    const mod = await import(`${pathToFileURL(copyPath).href}?t=${Date.now()}`);
    return await fn(mod);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("AGENTS.md word and byte limits", () => {
  it("1,199 words fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "AGENTS.md"), words(1199));
      const { failures } = checkAgents("AGENTS.md", dir);
      assert.ok(failures.some((f) => f.includes("word count 1199")));
    });
  });

  it("1,200 words passes", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "AGENTS.md"), words(1200));
      assert.equal(checkAgents("AGENTS.md", dir).failures.length, 0);
    });
  });

  it("1,500 words passes", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "AGENTS.md"), words(1500));
      assert.equal(checkAgents("AGENTS.md", dir).failures.length, 0);
    });
  });

  it("1,501 words fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "AGENTS.md"), words(1501));
      assert.ok(checkAgents("AGENTS.md", dir).failures.some((f) => f.includes("word count 1501")));
    });
  });

  it("12,001 bytes fails while word count remains valid", () => {
    withFixture((dir) => {
      let text = words(1200);
      while (Buffer.byteLength(text, "utf8") <= 12_000) text += "x";
      writeFileSync(join(dir, "AGENTS.md"), text);
      const { failures } = checkAgents("AGENTS.md", dir);
      assert.ok(failures.some((f) => f.includes("byte size")));
      assert.ok(!failures.some((f) => f.includes("word count")));
    });
  });

  it("UTF-8 BOM fails", () => {
    withFixture((dir) => {
      const body = Buffer.from(words(1200), "utf8");
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(join(dir, "AGENTS.md"), Buffer.concat([bom, body]));
      assert.ok(checkAgents("AGENTS.md", dir).failures.some((f) => f.includes("BOM")));
    });
  });
});

describe("CLAUDE.md shim", () => {
  it("exact shim passes", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), CLAUDE_EXPECTED);
      assert.equal(checkClaude("CLAUDE.md", dir).failures.length, 0);
    });
  });

  it("modified shim fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), "# Claude Code compatibility\n\n@AGENTS.md\n\nextra\n");
      assert.ok(checkClaude("CLAUDE.md", dir).failures.length > 0);
    });
  });

  it("duplicate include fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), "# Claude Code compatibility\n\n@AGENTS.md\n@AGENTS.md\n");
      assert.ok(checkClaude("CLAUDE.md", dir).failures.some((f) => f.includes("duplicate")));
    });
  });

  it("missing final newline fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), "# Claude Code compatibility\n\n@AGENTS.md");
      assert.ok(checkClaude("CLAUDE.md", dir).failures.some((f) => f.includes("final newline")));
    });
  });
});

describe("CURRENT.md dynamic state", () => {
  it("SHA fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\nCommit abcdef0123456789 is active.\n",
      );
      assert.ok(checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("sha")));
    });
  });

  it("UUID on same line does not exempt adjacent SHA", () => {
    const line =
      "Record 550e8400-e29b-41d4-a716-446655440000 references commit abcdef0123456789.";
    const failures = checkCurrentLine(line, 1, "docs/status/CURRENT.md");
    assert.ok(failures.some((f) => f.includes("sha")));
    assert.equal(failures.some((f) => f.includes("550e8400")), false);
  });

  it("TODO: fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(join(dir, "docs/status/CURRENT.md"), "# Posture\n\nTODO: wire governance.\n");
      assert.ok(checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("next-step")));
    });
  });

  it("todo: and Todo: fail case-insensitively", () => {
    for (const marker of ["todo: next item", "Todo: next item"]) {
      withFixture((dir) => {
        mkdirSync(join(dir, "docs/status"), { recursive: true });
        writeFileSync(join(dir, "docs/status/CURRENT.md"), `# Posture\n\n${marker}.\n`);
        const failures = checkCurrent("docs/status/CURRENT.md", dir).failures;
        assert.equal(failures.filter((f) => f.includes("next-step")).length, 1);
      });
    }
  });

  it("method prose containing todo without task marker passes", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\nA methodical review remains appropriate.\n",
      );
      assert.equal(checkCurrent("docs/status/CURRENT.md", dir).failures.length, 0);
    });
  });

  it("UUID alone passes without SHA failure", () => {
    const line = "Identifier 550e8400-e29b-41d4-a716-446655440000 is recorded.";
    const failures = checkCurrentLine(line, 1, "docs/status/CURRENT.md");
    assert.equal(failures.filter((f) => f.includes("sha")).length, 0);
  });

  it("malformed uuid-like token still triggers SHA category", () => {
    const line = "Commit 550e8400-e29b-41d4-a716-44665544000 extra abcdef0123456789.";
    const failures = checkCurrentLine(line, 1, "docs/status/CURRENT.md");
    assert.ok(failures.filter((f) => f.includes("sha")).length >= 1);
  });

  it("uuid word does not exempt SHA on same line", () => {
    const line = "See uuid documentation for commit abcdef0123456789.";
    const failures = checkCurrentLine(line, 1, "docs/status/CURRENT.md");
    assert.equal(failures.filter((f) => f.includes("sha")).length, 1);
  });

  it("PR reference fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(join(dir, "docs/status/CURRENT.md"), "# Posture\n\nSee PR #42 for status.\n");
      assert.ok(checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("pr")));
    });
  });

  it("test and migration counts fail", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\n275 assertions across 22 files.\n26 migrations applied.\n",
      );
      assert.ok(
        checkCurrent("docs/status/CURRENT.md", dir).failures.filter((f) => f.includes("count"))
          .length >= 2,
      );
    });
  });

  it("next gate fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(join(dir, "docs/status/CURRENT.md"), "# Posture\n\nNext gate is governance.\n");
      assert.ok(checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("next-step")));
    });
  });

  it("active task wording fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(join(dir, "docs/status/CURRENT.md"), "# Posture\n\nCurrent task is wiring CI.\n");
      assert.ok(checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("task")));
    });
  });

  it("inactive ae/control posture passes", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\nLive `ae/control` branch | **Not activated**\n",
      );
      assert.equal(checkCurrent("docs/status/CURRENT.md", dir).failures.length, 0);
    });
  });

  it("inactive language with activation planned on same line fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\nae/control is not activated; activation is planned.\n",
      );
      assert.ok(
        checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("ae-control")),
      );
    });
  });

  it("activated ae/control wording fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs/status"), { recursive: true });
      writeFileSync(
        join(dir, "docs/status/CURRENT.md"),
        "# Posture\n\nActivate ae/control next step.\n",
      );
      assert.ok(
        checkCurrent("docs/status/CURRENT.md", dir).failures.some((f) => f.includes("ae-control")),
      );
    });
  });
});

describe("inline gitleaks allow prohibition", () => {
  it("checker source does not contain forbidden literal", () => {
    const source = readFileSync(CHECK_SOURCE, "utf8");
    assert.equal(source.includes(inlineAllowDirectivePattern()), false);
  });

  it("clean tracked repository passes", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
      writeFileSync(join(dir, "README.md"), "# ok\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      assert.equal(checkInlineGitleaksAllow(dir).failures.length, 0);
    });
  });

  it("staged genuine directive fails", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
      writeFileSync(join(dir, "README.md"), "# ok\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      const directive = inlineAllowDirectivePattern();
      writeFileSync(join(dir, "bad.txt"), `${directive}\n`);
      execFileSync("git", ["add", "bad.txt"], { cwd: dir });
      assert.ok(checkInlineGitleaksAllow(dir).failures.length > 0);
    });
  });

  it("committed genuine directive fails", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
      const directive = inlineAllowDirectivePattern();
      writeFileSync(join(dir, "bad.txt"), `${directive}\n`);
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "bad"], { cwd: dir });
      assert.ok(checkInlineGitleaksAllow(dir).failures.length > 0);
    });
  });

  it("git search failure fails closed", () => {
    const { failures } = checkInlineGitleaksAllow(REPO_ROOT, {
      execFileSync: () => {
        const err = new Error("git failed");
        err.status = 128;
        throw err;
      },
    });
    assert.ok(failures.some((f) => f.includes("git-search-failed")));
  });
});

describe("Cursor rules manifest", () => {
  const saved = structuredClone(APPROVED_CURSOR_RULES);

  after(() => {
    for (const key of Object.keys(APPROVED_CURSOR_RULES)) delete APPROVED_CURSOR_RULES[key];
    Object.assign(APPROVED_CURSOR_RULES, saved);
  });

  it("no tracked rules passes", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      assert.equal(checkCursorRules(dir).failures.length, 0);
    });
  });

  it("unauthorized tracked rule fails", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      const rel = ".cursor/rules/unapproved.mdc";
      writeFileSync(join(dir, rel), "---\nalwaysApply: false\n---\n# Rule\n");
      execFileSync("git", ["add", rel], { cwd: dir });
      assert.ok(checkCursorRules(dir).failures.some((f) => f.includes("not in approved manifest")));
    });
  });

  it("approved alwaysApply false passes", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      const rel = ".cursor/rules/approved.mdc";
      writeFileSync(join(dir, rel), "---\nalwaysApply: false\n---\n# Rule\n");
      execFileSync("git", ["add", rel], { cwd: dir });
      APPROVED_CURSOR_RULES[rel] = { allowAlwaysApply: false };
      assert.equal(checkCursorRules(dir).failures.length, 0);
      delete APPROVED_CURSOR_RULES[rel];
    });
  });

  it("approved alwaysApply true with permission passes", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      const rel = ".cursor/rules/global.mdc";
      writeFileSync(join(dir, rel), "---\nalwaysApply: true\n---\n# Rule\n");
      execFileSync("git", ["add", rel], { cwd: dir });
      APPROVED_CURSOR_RULES[rel] = { allowAlwaysApply: true };
      assert.equal(checkCursorRules(dir).failures.length, 0);
      delete APPROVED_CURSOR_RULES[rel];
    });
  });

  it("alwaysApply true without authorization fails", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      const rel = ".cursor/rules/global.mdc";
      writeFileSync(join(dir, rel), "---\nalwaysApply: true\n---\n# Rule\n");
      execFileSync("git", ["add", rel], { cwd: dir });
      APPROVED_CURSOR_RULES[rel] = { allowAlwaysApply: false };
      assert.ok(checkCursorRules(dir).failures.some((f) => f.includes("alwaysApply true")));
      delete APPROVED_CURSOR_RULES[rel];
    });
  });

  it("duplicate alwaysApply fails", () => {
    withFixture((dir) => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      const rel = ".cursor/rules/dup.mdc";
      writeFileSync(join(dir, rel), "---\nalwaysApply: false\nalwaysApply: true\n---\n");
      execFileSync("git", ["add", rel], { cwd: dir });
      APPROVED_CURSOR_RULES[rel] = { allowAlwaysApply: true };
      assert.ok(checkCursorRules(dir).failures.some((f) => f.includes("duplicate")));
      delete APPROVED_CURSOR_RULES[rel];
    });
  });

  it("maybe, quoted booleans, and malformed frontmatter fail", () => {
    const cases = [
      ["maybe", "alwaysApply: maybe\n"],
      ["quoted", 'alwaysApply: "true"\n'],
      ["malformed", "alwaysApply true\n"],
      ["missing", "# no frontmatter\n"],
    ];
    for (const [label, body] of cases) {
      withFixture((dir) => {
        execFileSync("git", ["init", "-q"], { cwd: dir });
        mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
        const rel = `.cursor/rules/${label}.mdc`;
        writeFileSync(join(dir, rel), `---\n${body}---\n# Rule\n`);
        execFileSync("git", ["add", rel], { cwd: dir });
        APPROVED_CURSOR_RULES[rel] = { allowAlwaysApply: true };
        assert.ok(checkCursorRules(dir).failures.length > 0, label);
        delete APPROVED_CURSOR_RULES[rel];
      });
    }
  });

  it("git inventory failure fails closed", () => {
    const { failures } = checkCursorRules(REPO_ROOT, {
      execFileSync: () => {
        throw new Error("git unavailable");
      },
    });
    assert.ok(failures.some((f) => f.includes("git-inventory-failed")));
  });
});

describe("documentation routing links", () => {
  it("normal relative file passes", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [agents](AGENTS.md).\n");
      writeFileSync(join(dir, "AGENTS.md"), words(1200));
      assert.equal(checkDocumentLinks("README.md", dir).failures.length, 0);
    });
  });

  it("relative directory passes", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs/child.md"), "# child\n");
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [docs](docs/).\n");
      assert.equal(checkDocumentLinks("README.md", dir).failures.length, 0);
    });
  });

  it("fragment-only link passes", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [top](#top).\n");
      assert.equal(checkDocumentLinks("README.md", dir).failures.length, 0);
    });
  });

  it("missing target fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [missing](does/not/exist.md).\n");
      assert.ok(checkDocumentLinks("README.md", dir).failures.some((f) => f.includes("broken link")));
    });
  });

  it("parent traversal fails even when outside target exists", () => {
    withFixture((dir) => {
      const outside = join(dirname(dir), "gov-link-outside.md");
      writeFileSync(outside, "# outside\n");
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(
        join(dir, "docs/page.md"),
        "# page\n\nSee [escape](../../gov-link-outside.md).\n",
      );
      assert.ok(
        checkDocumentLinks("docs/page.md", dir).failures.some((f) => f.includes("repository-escape")),
      );
      rmSync(outside, { force: true });
    });
  });

  it("absolute path fails", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [abs](/etc/passwd).\n");
      assert.ok(
        checkDocumentLinks("README.md", dir).failures.some((f) => f.includes("absolute-path")),
      );
    });
  });

  it("symlink escape fails when link target resolves outside repository", () => {
    withFixture((dir) => {
      const outside = join(dirname(dir), "gov-symlink-outside.md");
      writeFileSync(outside, "# outside\n");
      mkdirSync(join(dir, "docs"), { recursive: true });
      symlinkSync(outside, join(dir, "docs/escape-link.md"));
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [link](docs/escape-link.md).\n");
      assert.ok(checkDocumentLinks("README.md", dir).failures.length > 0);
      rmSync(outside, { force: true });
    });
  });

  it("error output does not include raw target", () => {
    withFixture((dir) => {
      const secretTarget = "../SECRET-TARGET-VALUE-12345.md";
      writeFileSync(join(dir, "README.md"), `# Readme\n\nSee [x](${secretTarget}).\n`);
      const failures = checkDocumentLinks("README.md", dir).failures;
      assert.ok(failures.length > 0);
      assert.equal(failures.join("\n").includes("SECRET-TARGET-VALUE"), false);
    });
  });

  it("missing legacy banner fails", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs/HANDOFF.md"), "# Handoff\n\nBody\n");
      assert.ok(checkTopBanner("docs/HANDOFF.md", ["historical"], dir).failures.length > 0);
    });
  });

  it("active HANDOFF routing fails without evidence language", () => {
    withFixture((dir) => {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs/HANDOFF.md"), "> historical\n\nBody\n");
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [handoff](docs/HANDOFF.md) for tasks.\n");
      assert.ok(
        checkDocumentLinks("README.md", dir).failures.some((f) => f.includes("HANDOFF.md link")),
      );
    });
  });
});

describe("live repository policy suite", () => {
  it("passes on checked-in governance documents", () => {
    const { ok, failures } = runAllChecks(REPO_ROOT);
    if (!ok) console.error(failures);
    assert.equal(ok, true);
  });
});

describe("validator mutation evidence via temporary copies", () => {
  it("inverted AGENTS minimum fails 1,200-word fixture", async () => {
    await withMutatedCheckModule(
      (source) =>
        source.replace(
          "if (words < AGENTS_MIN_WORDS || words > AGENTS_MAX_WORDS)",
          "if (words < 999999 || words > AGENTS_MAX_WORDS)",
        ),
      async (mod) => {
        withFixture((dir) => {
          writeFileSync(join(dir, "AGENTS.md"), words(1200));
          assert.ok(mod.checkAgents("AGENTS.md", dir).failures.length > 0);
        });
      },
    );
  });

  it("inverted CLAUDE exact match fails valid shim", async () => {
    await withMutatedCheckModule(
      (source) => source.replace("if (text !== CLAUDE_EXPECTED)", "if (text === CLAUDE_EXPECTED)"),
      async (mod) => {
        withFixture((dir) => {
          writeFileSync(join(dir, "CLAUDE.md"), mod.CLAUDE_EXPECTED);
          assert.ok(mod.checkClaude("CLAUDE.md", dir).failures.length > 0);
        });
      },
    );
  });

  it("disabled SHA detection fails SHA fixture", async () => {
    await withMutatedCheckModule(
      (source) =>
        source.replace(
          "for (const token of findShaLikeTokens(line)) {",
          "if (false) for (const token of findShaLikeTokens(line)) {",
        ),
      async (mod) => {
        withFixture((dir) => {
          mkdirSync(join(dir, "docs/status"), { recursive: true });
          writeFileSync(
            join(dir, "docs/status/CURRENT.md"),
            "# Posture\n\nCommit abcdef0123456789 is active.\n",
          );
          assert.equal(mod.checkCurrent("docs/status/CURRENT.md", dir).failures.length, 0);
        });
      },
    );
  });

  it("inverted legacy banner check passes missing banner", async () => {
    await withMutatedCheckModule(
      (source) =>
        source.replace(
          "if (!head.includes(snippet.toLowerCase())) {",
          "if (false && !head.includes(snippet.toLowerCase())) {",
        ),
      async (mod) => {
        withFixture((dir) => {
          mkdirSync(join(dir, "docs"), { recursive: true });
          writeFileSync(join(dir, "docs/HANDOFF.md"), "# Handoff\n\nBody\n");
          assert.equal(
            mod.checkTopBanner("docs/HANDOFF.md", ["historical"], dir).failures.length,
            0,
          );
        });
      },
    );
  });

  it("disabled path-boundary checks would allow repository escape", async () => {
    await withMutatedCheckModule(
      (source) =>
        source
          .replace(
            'if (rel.startsWith("..") || isAbsolute(rel)) {',
            'if (false && rel.startsWith("..")) {',
          )
          .replace(
            "return targetReal === rootReal || targetReal.startsWith(rootReal + sep);",
            "return true;",
          ),
      async (mod) => {
        withFixture((dir) => {
          const outsideRoot = mkdtempSync(join(tmpdir(), "gov-mut-outside-"));
          try {
            assertOutsideRepo(outsideRoot);
            const outsideName = `target-${randomBytes(8).toString("hex")}.md`;
            const outsideFile = join(outsideRoot, outsideName);
            writeFileSync(outsideFile, "# outside\n");
            const docsDir = join(dir, "docs");
            mkdirSync(docsDir, { recursive: true });
            const relFromDocs = relative(docsDir, outsideFile).split("\\").join("/");
            writeFileSync(join(docsDir, "page.md"), `# page\n\nSee [x](${relFromDocs}).\n`);
            assert.equal(mod.checkDocumentLinks("docs/page.md", dir).failures.length, 0);
          } finally {
            rmSync(outsideRoot, { recursive: true, force: true });
          }
        });
      },
    );
  });

  it("path-boundary mutation test stays isolated under concurrent runs", async () => {
    const mutate = (source) =>
      source
        .replace(
          'if (rel.startsWith("..") || isAbsolute(rel)) {',
          'if (false && rel.startsWith("..")) {',
        )
        .replace(
          "return targetReal === rootReal || targetReal.startsWith(rootReal + sep);",
          "return true;",
        );

    const runOnce = () =>
      withMutatedCheckModule(mutate, async (mod) =>
        withFixture((dir) => {
          const outsideRoot = mkdtempSync(join(tmpdir(), "gov-mut-outside-"));
          try {
            assertOutsideRepo(outsideRoot);
            const outsideName = `target-${randomBytes(8).toString("hex")}.md`;
            const outsideFile = join(outsideRoot, outsideName);
            writeFileSync(outsideFile, "# outside\n");
            const docsDir = join(dir, "docs");
            mkdirSync(docsDir, { recursive: true });
            const relFromDocs = relative(docsDir, outsideFile).split("\\").join("/");
            writeFileSync(join(docsDir, "page.md"), `# page\n\nSee [x](${relFromDocs}).\n`);
            return mod.checkDocumentLinks("docs/page.md", dir).failures.length;
          } finally {
            rmSync(outsideRoot, { recursive: true, force: true });
          }
        }),
      );

    const results = await Promise.all(Array.from({ length: 8 }, () => runOnce()));
    assert.deepEqual(results, Array(8).fill(0));
  });
});

describe("classifyDocLink", () => {
  it("marks web links external", () => {
    assert.equal(classifyDocLink("README.md", "https://example.com").kind, "external");
    assert.equal(classifyDocLink("README.md", "http://example.com").kind, "external");
    assert.equal(classifyDocLink("README.md", "mailto:team@example.com").kind, "external");
  });

  it("rejects disallowed URI schemes without echoing target", () => {
    const schemes = ["file:///etc/passwd", "javascript:alert(1)", "data:text/plain,hi", "ftp://example.com/x"];
    for (const target of schemes) {
      const classified = classifyDocLink("README.md", target);
      assert.equal(classified.kind, "invalid");
      assert.equal(classified.category, "disallowed-scheme");
      withFixture((dir) => {
        writeFileSync(join(dir, "README.md"), `# Readme\n\nSee [x](${target}).\n`);
        const failures = checkDocumentLinks("README.md", dir).failures;
        assert.equal(failures.length, 1);
        assert.equal(failures[0].includes(target), false);
      });
    }
  });

  it("rejects protocol-relative links", () => {
    withFixture((dir) => {
      writeFileSync(join(dir, "README.md"), "# Readme\n\nSee [x](//example.com/path).\n");
      assert.ok(
        checkDocumentLinks("README.md", dir).failures.some((f) => f.includes("disallowed-scheme")),
      );
    });
  });
});
