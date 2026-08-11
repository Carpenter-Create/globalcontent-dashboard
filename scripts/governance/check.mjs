#!/usr/bin/env node
/**
 * Repository governance policy checker — dependency-free Node built-ins only.
 */
import {
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../..");

export const AGENTS_MIN_WORDS = 1200;
export const AGENTS_MAX_WORDS = 1500;
export const AGENTS_MAX_BYTES = 12_000;

export const CLAUDE_EXPECTED = "# Claude Code compatibility\n\n@AGENTS.md\n";

/** @type {Record<string, { allowAlwaysApply?: boolean }>} */
export const APPROVED_CURSOR_RULES = {};

export const ROUTING_DOCUMENTS = [
  "AGENTS.md",
  "README.md",
  "docs/status/CURRENT.md",
  "docs/engineering/operational-gotchas.md",
  "docs/first-slice-implementation-spec.md",
  "docs/HANDOFF.md",
];

const HANDOFF_EVIDENCE_RE =
  /historical|evidence[\s-]only|not[\s-]authority|not current|superseded|preserve as evidence/i;

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto"]);

/** Construct prohibited inline allow directive without storing its literal in source. */
export function inlineAllowDirectivePattern() {
  return ["gitleaks", ":", "allow"].join("");
}

/**
 * @param {string} text
 */
export function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * @param {string} text
 */
export function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/**
 * @param {string} relPath
 * @param {string} [root]
 */
export function readRepoFile(relPath, root = REPO_ROOT) {
  const abs = join(root, relPath);
  return readFileSync(abs);
}

/**
 * @param {Buffer} buf
 */
export function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

/**
 * @param {string} relPath
 * @param {string} [root]
 */
export function checkAgents(relPath = "AGENTS.md", root = REPO_ROOT) {
  const failures = [];
  const buf = readRepoFile(relPath, root);
  if (hasUtf8Bom(buf)) {
    failures.push(`${relPath}: UTF-8 BOM rejected`);
    return { failures };
  }
  const text = normalizeText(buf.toString("utf8"));
  const words = countWords(text);
  const bytes = Buffer.byteLength(text, "utf8");
  if (words < AGENTS_MIN_WORDS || words > AGENTS_MAX_WORDS) {
    failures.push(
      `${relPath}: word count ${words} outside ${AGENTS_MIN_WORDS}–${AGENTS_MAX_WORDS}`,
    );
  }
  if (bytes > AGENTS_MAX_BYTES) {
    failures.push(`${relPath}: byte size ${bytes} exceeds ${AGENTS_MAX_BYTES}`);
  }
  return { failures, words, bytes };
}

/**
 * @param {string} relPath
 * @param {string} [root]
 */
export function checkClaude(relPath = "CLAUDE.md", root = REPO_ROOT) {
  const failures = [];
  const buf = readRepoFile(relPath, root);
  if (hasUtf8Bom(buf)) {
    failures.push(`${relPath}: UTF-8 BOM rejected`);
    return { failures };
  }
  const text = buf.toString("utf8");
  if (text !== CLAUDE_EXPECTED) {
    failures.push(`${relPath}: must match exact UTF-8 shim bytes including final newline`);
  }
  const lines = text.split("\n");
  const includeLines = lines.filter((l) => l.trim() === "@AGENTS.md");
  if (includeLines.length !== 1) {
    failures.push(`${relPath}: duplicate or missing @AGENTS.md include`);
  }
  if (lines.some((l) => l.trim().startsWith("#") && l.trim() !== "# Claude Code compatibility")) {
    failures.push(`${relPath}: extra doctrine or comments rejected`);
  }
  if (!text.endsWith("\n")) {
    failures.push(`${relPath}: missing final newline`);
  }
  if (text.includes("\n\n\n")) {
    failures.push(`${relPath}: additional blank lines rejected`);
  }
  return { failures };
}

/**
 * @param {string} line
 */
export function findUuidSpans(line) {
  /** @type {{ start: number, end: number }[]} */
  const spans = [];
  UUID_RE.lastIndex = 0;
  let m;
  while ((m = UUID_RE.exec(line)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * @param {number} index
 * @param {number} length
 * @param {{ start: number, end: number }[]} spans
 */
export function isWithinUuidSpan(index, length, spans) {
  const end = index + length;
  return spans.some((span) => index >= span.start && end <= span.end);
}

/**
 * @param {string} line
 */
export function findShaLikeTokens(line) {
  const tokens = [];
  const re = /\b[a-f0-9]{7,40}\b/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ value: m[0], index: m.index });
  }
  return tokens;
}

/**
 * @param {string} line
 * @param {number} lineNo
 * @param {string} relPath
 * @returns {string[]}
 */
export function checkCurrentLine(line, lineNo, relPath) {
  const failures = [];
  const lower = line.toLowerCase();

  const uuidSpans = findUuidSpans(line);

  for (const token of findShaLikeTokens(line)) {
    if (!isWithinUuidSpan(token.index, token.value.length, uuidSpans)) {
      failures.push(`${relPath}:${lineNo}: SHA-like token (category: sha)`);
    }
  }

  if (/\b(?:PR|pull request)\s*#?\d+\b/i.test(line) || /\(#\d+\)/.test(line)) {
    failures.push(`${relPath}:${lineNo}: pull-request reference (category: pr)`);
  }
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(line)) {
    failures.push(`${relPath}:${lineNo}: ISO date (category: date)`);
  }
  for (const phrase of [
    "last verified",
    "verified on",
    "current as of",
    "updated on",
  ]) {
    if (lower.includes(phrase)) {
      failures.push(`${relPath}:${lineNo}: temporal verification phrase (category: date)`);
    }
  }
  if (
    /\b\d+\s+(?:tests?|assertions?|migrations?)\b/i.test(line) ||
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:tests?|assertions?|migrations?)\b/i.test(
      line,
    )
  ) {
    failures.push(`${relPath}:${lineNo}: test or migration count (category: count)`);
  }
  if (/\b(?:current|active)\s+task\b/i.test(line) || /\btask[\s-]scope\b/i.test(line)) {
    failures.push(`${relPath}:${lineNo}: active task language (category: task)`);
  }
  if (
    /\bnext\s+(?:gate|step|work)\b/i.test(line) ||
    /\bremaining\s+work\b/i.test(line) ||
    /\btask[\s-]oriented\s+todo\b/i.test(line) ||
    /\btodo\s*:/i.test(line)
  ) {
    failures.push(`${relPath}:${lineNo}: next-step or TODO language (category: next-step)`);
  }
  if (
    /\b(?:feature|chore|fix|hotfix|spike|task)\/[a-z0-9._-]+\b/i.test(line) &&
    !/\bnot activated\b/i.test(line)
  ) {
    failures.push(`${relPath}:${lineNo}: task branch prefix (category: branch)`);
  }

  if (/ae\/control/i.test(line)) {
    const inactivePosture =
      /\b(?:not activated|not active|inactive|abandoned|unmerged)\b/i.test(line);
    const activationIntent =
      /\b(?:next step|next gate|remaining work|planned)\b/i.test(line) ||
      (/\bactivat(?:e|ed|ion)\b/i.test(line) &&
        !/\bnot activat(?:e|ed|ion)\b/i.test(line));
    if (activationIntent) {
      failures.push(`${relPath}:${lineNo}: ae/control activation language (category: ae-control)`);
    } else if (!inactivePosture) {
      failures.push(`${relPath}:${lineNo}: ae/control without inactive posture (category: ae-control)`);
    }
  }

  return failures;
}

/**
 * @param {string} relPath
 * @param {string} [root]
 */
export function checkCurrent(relPath = "docs/status/CURRENT.md", root = REPO_ROOT) {
  const text = normalizeText(readRepoFile(relPath, root).toString("utf8"));
  const failures = [];
  text.split("\n").forEach((line, idx) => {
    failures.push(...checkCurrentLine(line, idx + 1, relPath));
  });
  return { failures };
}

/**
 * @param {string} content
 */
export function parseMdcAlwaysApply(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { malformed: true, values: [], missing: true };
  const body = match[1];
  const values = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("alwaysApply")) continue;
    const m = trimmed.match(/^alwaysApply\s*:\s*(true|false)\s*$/);
    if (m) {
      values.push(m[1] === "true");
      continue;
    }
    return { malformed: true, values: [], invalidValue: true };
  }
  if (values.length === 0) {
    return { malformed: true, values: [], missing: true };
  }
  return { malformed: false, values };
}

/**
 * @param {string} [root]
 * @param {{ execFileSync?: typeof execFileSync }} [options]
 */
export function listTrackedCursorRules(root = REPO_ROOT, options = {}) {
  const exec = options.execFileSync ?? execFileSync;
  try {
    const out = exec("git", ["ls-files", ".cursor/rules"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (!out) return { ok: true, rules: [] };
    return {
      ok: true,
      rules: out
        .split("\n")
        .filter((p) => p.endsWith(".mdc"))
        .sort(),
    };
  } catch {
    return { ok: false, rules: [] };
  }
}

/**
 * @param {string} [root]
 * @param {{ execFileSync?: typeof execFileSync }} [options]
 */
export function checkCursorRules(root = REPO_ROOT, options = {}) {
  const failures = [];
  const inventory = listTrackedCursorRules(root, options);
  if (!inventory.ok) {
    failures.push("cursor-rules: git-inventory-failed (category: cursor-inventory)");
    return { failures };
  }
  for (const relPath of inventory.rules) {
    const approval = APPROVED_CURSOR_RULES[relPath];
    if (!approval) {
      failures.push(`${relPath}: tracked Cursor rule not in approved manifest`);
      continue;
    }
    const content = readRepoFile(relPath, root).toString("utf8");
    const parsed = parseMdcAlwaysApply(content);
    if (parsed.malformed) {
      if (parsed.invalidValue) {
        failures.push(`${relPath}: invalid alwaysApply value`);
      } else if (parsed.missing) {
        failures.push(`${relPath}: missing alwaysApply declaration`);
      } else {
        failures.push(`${relPath}: malformed Cursor rule frontmatter`);
      }
      continue;
    }
    if (parsed.values.length !== 1) {
      failures.push(`${relPath}: duplicate alwaysApply declaration`);
      continue;
    }
    const alwaysApply = parsed.values[0];
    if (alwaysApply && !approval.allowAlwaysApply) {
      failures.push(`${relPath}: alwaysApply true without explicit authorization`);
    }
  }
  return { failures };
}

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * @param {string} linkTarget
 */
export function stripFragment(linkTarget) {
  const hash = linkTarget.indexOf("#");
  return hash === -1 ? linkTarget : linkTarget.slice(0, hash);
}

/**
 * @param {string} root
 * @param {string} absPath
 */
export function isPathInsideRepo(root, absPath) {
  const rootReal = realpathSync(root);
  let targetReal;
  try {
    targetReal = realpathSync(absPath);
  } catch {
    return false;
  }
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

/**
 * @param {string} sourceRel
 * @param {string} linkTarget
 * @param {string} [root]
 */
export function classifyDocLink(sourceRel, linkTarget, root = REPO_ROOT) {
  const clean = stripFragment(linkTarget.trim());
  if (!clean || clean.startsWith("#")) {
    return { kind: "skip" };
  }
  if (clean.startsWith("//")) {
    return { kind: "invalid", category: "disallowed-scheme" };
  }
  const schemeMatch = clean.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (ALLOWED_LINK_SCHEMES.has(scheme)) {
      return { kind: "external" };
    }
    return { kind: "invalid", category: "disallowed-scheme" };
  }
  if (isAbsolute(clean) || /^[A-Za-z]:[\\/]/.test(clean)) {
    return { kind: "invalid", category: "absolute-path" };
  }
  if (clean.includes("\\")) {
    return { kind: "invalid", category: "non-repository-path" };
  }

  const sourceDir = dirname(sourceRel);
  const resolved = resolve(join(root, sourceDir, clean));
  const rel = relative(root, resolved).split("\\").join("/");
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { kind: "invalid", category: "repository-escape" };
  }
  return { kind: "repo", rel, abs: resolved };
}

/**
 * @param {string} relPath
 * @param {string} [root]
 */
export function checkDocumentLinks(relPath, root = REPO_ROOT) {
  const failures = [];
  const text = readRepoFile(relPath, root).toString("utf8");
  const lines = normalizeText(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(line)) !== null) {
      const target = m[2];
      const classified = classifyDocLink(relPath, target, root);
      if (classified.kind === "skip" || classified.kind === "external") continue;
      if (classified.kind === "invalid") {
        failures.push(`${relPath}:${i + 1}: link ${classified.category} (category: link)`);
        continue;
      }
      const abs = classified.abs;
      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        failures.push(`${relPath}:${i + 1}: broken link (category: link)`);
        continue;
      }
      if (stat.isSymbolicLink() && !isPathInsideRepo(root, abs)) {
        failures.push(`${relPath}:${i + 1}: symlink escape (category: link)`);
        continue;
      }
      if (!existsSync(abs)) {
        failures.push(`${relPath}:${i + 1}: broken link (category: link)`);
        continue;
      }
      if (!isPathInsideRepo(root, abs)) {
        failures.push(`${relPath}:${i + 1}: repository-escape (category: link)`);
        continue;
      }
      if (
        classified.rel.endsWith("docs/HANDOFF.md") &&
        ROUTING_DOCUMENTS.includes(relPath) &&
        relPath !== "docs/HANDOFF.md" &&
        !HANDOFF_EVIDENCE_RE.test(line)
      ) {
        failures.push(
          `${relPath}:${i + 1}: HANDOFF.md link without historical/evidence-only language`,
        );
      }
    }
  }
  return { failures };
}

/**
 * @param {string} relPath
 * @param {string[]} requiredSnippets
 * @param {string} [root]
 */
export function checkTopBanner(relPath, requiredSnippets, root = REPO_ROOT) {
  const text = readRepoFile(relPath, root).toString("utf8");
  const head = normalizeText(text).split("\n").slice(0, 20).join("\n").toLowerCase();
  const failures = [];
  for (const snippet of requiredSnippets) {
    if (!head.includes(snippet.toLowerCase())) {
      failures.push(`${relPath}: missing required banner phrase "${snippet}"`);
    }
  }
  return { failures };
}

/**
 * @param {string} [root]
 */
export function checkLegacyBanners(root = REPO_ROOT) {
  const failures = [];
  failures.push(
    ...checkTopBanner("docs/HANDOFF.md", ["historical", "not current", "CURRENT.md"], root)
      .failures,
  );
  failures.push(
    ...checkTopBanner(
      "docs/first-slice-implementation-spec.md",
      ["historical", "superseded", "CURRENT.md"],
      root,
    ).failures,
  );
  return { failures };
}

/**
 * @param {string} [root]
 * @param {{ execFileSync?: typeof execFileSync }} [options]
 */
export function checkInlineGitleaksAllow(root = REPO_ROOT, options = {}) {
  const failures = [];
  const exec = options.execFileSync ?? execFileSync;
  const pattern = inlineAllowDirectivePattern();
  try {
    const out = exec("git", ["grep", "-n", "--full-name", pattern], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (out) {
      for (const row of out.split("\n")) {
        const colon = row.indexOf(":");
        if (colon === -1) continue;
        const file = row.slice(0, colon);
        const line = row.slice(colon + 1).split(":")[0];
        failures.push(`${file}:${line}: inline allow directive prohibited (category: gitleaks-allow)`);
      }
    }
  } catch (err) {
    const status = /** @type {{ status?: number }} */ (err).status;
    if (status === 1) {
      return { failures };
    }
    failures.push("gitleaks-inline-allow: git-search-failed (category: gitleaks-allow)");
  }
  return { failures };
}

/**
 * @param {string} [root]
 * @param {{ execFileSync?: typeof execFileSync }} [options]
 */
export function runAllChecks(root = REPO_ROOT, options = {}) {
  const failures = [];
  failures.push(...checkAgents("AGENTS.md", root).failures);
  failures.push(...checkClaude("CLAUDE.md", root).failures);
  failures.push(...checkCurrent("docs/status/CURRENT.md", root).failures);
  failures.push(...checkCursorRules(root, options).failures);
  for (const doc of ROUTING_DOCUMENTS) {
    failures.push(...checkDocumentLinks(doc, root).failures);
  }
  failures.push(...checkLegacyBanners(root).failures);
  failures.push(...checkInlineGitleaksAllow(root, options).failures);
  return { failures, ok: failures.length === 0 };
}

function main() {
  const { failures, ok } = runAllChecks();
  if (!ok) {
    for (const f of failures) console.error(`governance check: ${f}`);
    process.exit(1);
  }
  console.log("governance check: all policy invariants satisfied");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
