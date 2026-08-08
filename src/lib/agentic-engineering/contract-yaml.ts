import {
  parseTaskContract,
  type AcceptanceCriterion,
  type BaselineException,
  type SourceRef,
  type TaskContract,
} from "./contract-schema";

/**
 * Canonical frozen contract YAML subset.
 *
 * All string scalars are JSON-style double-quoted.
 * Booleans are only bare `true` / `false`.
 * Integers are bare decimal digits (lexical).
 * Digest binds exact frozen UTF-8 bytes after canonical-form assertion.
 */

function q(s: string): string {
  return JSON.stringify(s);
}

function emitSourceRef(ref: SourceRef, indent: string): string[] {
  const lines = [`${indent}- path: ${q(ref.path)}`];
  if (ref.sections && ref.sections.length > 0) {
    lines.push(`${indent}  sections:`);
    for (const sec of ref.sections) {
      lines.push(`${indent}    - ${q(sec)}`);
    }
  }
  return lines;
}

function emitBaseline(ex: BaselineException, indent: string): string[] {
  const lines = [
    `${indent}- check_name: ${q(ex.check_name)}`,
    `${indent}  failing_step: ${q(ex.failing_step)}`,
    `${indent}  fingerprint: ${q(ex.fingerprint)}`,
  ];
  if (ex.note !== undefined) {
    lines.push(`${indent}  note: ${q(ex.note)}`);
  }
  return lines;
}

function emitCriterion(c: AcceptanceCriterion, indent: string): string[] {
  return [
    `${indent}- id: ${q(c.id)}`,
    `${indent}  description: ${q(c.description)}`,
  ];
}

export function formatCanonicalContractYaml(contract: TaskContract): string {
  const c = parseTaskContract(contract);
  const lines: string[] = [
    `schema_version: ${c.schema_version}`,
    `task_id: ${q(c.task_id)}`,
    `contract_version: ${c.contract_version}`,
    `title: ${q(c.title)}`,
    `authorized_scope:`,
    ...c.authorized_scope.map((s) => `  - ${q(s)}`),
    `out_of_scope:`,
    ...(c.out_of_scope.length === 0
      ? [`  []`]
      : c.out_of_scope.map((s) => `  - ${q(s)}`)),
    `source_refs:`,
    ...c.source_refs.flatMap((r) => emitSourceRef(r, "  ")),
    `base_branch: ${q(c.base_branch)}`,
    `base_sha: ${q(c.base_sha)}`,
    `work_branch: ${q(c.work_branch)}`,
    `role_separation: ${q(c.role_separation)}`,
    `implementer:`,
    `  agent: ${q(c.implementer.agent)}`,
    `reviewer:`,
    `  agent: ${q(c.reviewer.agent)}`,
    `validation_additions:`,
    `  commands:`,
    ...(c.validation_additions.commands.length === 0
      ? [`    []`]
      : c.validation_additions.commands.map((x) => `    - ${q(x)}`)),
    `  status_checks:`,
    ...(c.validation_additions.status_checks.length === 0
      ? [`    []`]
      : c.validation_additions.status_checks.map((x) => `    - ${q(x)}`)),
    `baseline_exceptions:`,
    ...(c.baseline_exceptions.length === 0
      ? [`  []`]
      : c.baseline_exceptions.flatMap((ex) => emitBaseline(ex, "  "))),
    `may_draft_migration_sql: ${c.may_draft_migration_sql}`,
    `may_draft_production_runbook: ${c.may_draft_production_runbook}`,
    `dependency_addition_allowed: ${c.dependency_addition_allowed}`,
    `ci_workflow_change_allowed: ${c.ci_workflow_change_allowed}`,
    `review_intensity: ${q(c.review_intensity)}`,
    `max_remediation_rounds: ${c.max_remediation_rounds}`,
    `acceptance_criteria:`,
    ...c.acceptance_criteria.flatMap((ac) => emitCriterion(ac, "  ")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Parse only canonical double-quoted JSON strings. */
function parseQuotedString(raw: string): string {
  const t = raw.trim();
  if (!(t.startsWith('"') && t.endsWith('"'))) {
    throw new Error(`expected double-quoted string, got: ${raw}`);
  }
  if (t.includes("'") && !t.includes("\\")) {
    // single quotes inside JSON string are fine; reject single-quoted YAML form entirely
  }
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v !== "string") throw new Error("not a string");
    return v;
  } catch {
    throw new Error(`invalid JSON string scalar: ${raw}`);
  }
}

function parseBool(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`invalid boolean (only true|false): ${raw}`);
}

function parsePositiveInt(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw) && raw !== "0") {
    throw new Error(`invalid integer: ${raw}`);
  }
  // schema_version may be 1; allow 0 only for completeness then zod rejects if needed
  if (raw !== "0" && !/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`invalid integer: ${raw}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`integer not safe: ${raw}`);
  return n;
}

type Line = { indent: number; content: string };

function parseLines(text: string): Line[] {
  if (text.includes("\r")) {
    throw new Error("contract YAML must use LF line endings only");
  }
  if (!text.endsWith("\n")) {
    throw new Error("contract YAML must end with a trailing newline");
  }
  const rawLines = text.slice(0, -1).split("\n");
  return rawLines.map((line, i) => {
    if (line.trimEnd() !== line) {
      throw new Error(`trailing whitespace on line ${i + 1}`);
    }
    if (line.includes("\t")) {
      throw new Error(`tabs forbidden on line ${i + 1}`);
    }
    const m = /^( *)(.*)$/.exec(line);
    if (!m) throw new Error(`bad line ${i + 1}`);
    return { indent: m[1].length, content: m[2] };
  });
}

export function parseCanonicalContractYaml(text: string): TaskContract {
  const lines = parseLines(text);
  const root: Record<string, unknown> = {};
  let i = 0;

  function expectRootKey(name: string): string {
    const line = lines[i];
    if (!line || line.indent !== 0) {
      throw new Error(`expected root key ${name}`);
    }
    const idx = line.content.indexOf(":");
    if (idx < 0) throw new Error(`expected key ${name}`);
    const key = line.content.slice(0, idx);
    if (key !== name) throw new Error(`expected ${name}, got ${key}`);
    const rest = line.content.slice(idx + 1).trim();
    i += 1;
    return rest;
  }

  function parseStringList(indent: number): string[] {
    const first = lines[i];
    if (first && first.indent === indent && first.content === "[]") {
      i += 1;
      return [];
    }
    const out: string[] = [];
    while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith("- ")) {
      out.push(parseQuotedString(lines[i].content.slice(2)));
      i += 1;
    }
    return out;
  }

  root.schema_version = parsePositiveInt(expectRootKey("schema_version"));
  root.task_id = parseQuotedString(expectRootKey("task_id"));
  root.contract_version = parsePositiveInt(expectRootKey("contract_version"));
  root.title = parseQuotedString(expectRootKey("title"));

  expectRootKey("authorized_scope");
  root.authorized_scope = parseStringList(2);

  expectRootKey("out_of_scope");
  root.out_of_scope = parseStringList(2);

  expectRootKey("source_refs");
  const sourceRefs: SourceRef[] = [];
  while (i < lines.length && lines[i].indent === 2 && lines[i].content.startsWith("- path:")) {
    const path = parseQuotedString(lines[i].content.slice("- path:".length).trim());
    i += 1;
    let sections: string[] | undefined;
    if (i < lines.length && lines[i].indent === 4 && lines[i].content === "sections:") {
      i += 1;
      sections = [];
      while (
        i < lines.length &&
        lines[i].indent === 6 &&
        lines[i].content.startsWith("- ")
      ) {
        sections.push(parseQuotedString(lines[i].content.slice(2)));
        i += 1;
      }
    }
    sourceRefs.push(sections ? { path, sections } : { path });
  }
  root.source_refs = sourceRefs;

  root.base_branch = parseQuotedString(expectRootKey("base_branch"));
  root.base_sha = parseQuotedString(expectRootKey("base_sha"));
  root.work_branch = parseQuotedString(expectRootKey("work_branch"));
  root.role_separation = parseQuotedString(expectRootKey("role_separation"));

  expectRootKey("implementer");
  if (!lines[i] || lines[i].indent !== 2 || !lines[i].content.startsWith("agent:")) {
    throw new Error("expected implementer.agent");
  }
  root.implementer = {
    agent: parseQuotedString(lines[i].content.slice("agent:".length).trim()),
  };
  i += 1;

  expectRootKey("reviewer");
  if (!lines[i] || lines[i].indent !== 2 || !lines[i].content.startsWith("agent:")) {
    throw new Error("expected reviewer.agent");
  }
  root.reviewer = {
    agent: parseQuotedString(lines[i].content.slice("agent:".length).trim()),
  };
  i += 1;

  expectRootKey("validation_additions");
  if (!lines[i] || lines[i].content !== "commands:") throw new Error("expected commands");
  i += 1;
  const commands = parseStringList(4);
  if (!lines[i] || lines[i].content !== "status_checks:") {
    throw new Error("expected status_checks");
  }
  i += 1;
  const status_checks = parseStringList(4);
  root.validation_additions = { commands, status_checks };

  expectRootKey("baseline_exceptions");
  const baselines: BaselineException[] = [];
  if (i < lines.length && lines[i].indent === 2 && lines[i].content === "[]") {
    i += 1;
  } else {
    while (i < lines.length && lines[i].indent === 2 && lines[i].content.startsWith("- ")) {
      const check_name = parseQuotedString(
        lines[i].content.replace(/^- check_name:\s*/, ""),
      );
      i += 1;
      if (!lines[i]?.content.startsWith("failing_step:")) throw new Error("failing_step");
      const failing_step = parseQuotedString(
        lines[i].content.slice("failing_step:".length).trim(),
      );
      i += 1;
      if (!lines[i]?.content.startsWith("fingerprint:")) throw new Error("fingerprint");
      const fingerprint = parseQuotedString(
        lines[i].content.slice("fingerprint:".length).trim(),
      );
      i += 1;
      let note: string | undefined;
      if (i < lines.length && lines[i].indent === 4 && lines[i].content.startsWith("note:")) {
        note = parseQuotedString(lines[i].content.slice("note:".length).trim());
        i += 1;
      }
      baselines.push(
        note
          ? { check_name, failing_step, fingerprint, note }
          : { check_name, failing_step, fingerprint },
      );
    }
  }
  root.baseline_exceptions = baselines;

  root.may_draft_migration_sql = parseBool(expectRootKey("may_draft_migration_sql"));
  root.may_draft_production_runbook = parseBool(
    expectRootKey("may_draft_production_runbook"),
  );
  root.dependency_addition_allowed = parseBool(
    expectRootKey("dependency_addition_allowed"),
  );
  root.ci_workflow_change_allowed = parseBool(
    expectRootKey("ci_workflow_change_allowed"),
  );
  root.review_intensity = parseQuotedString(expectRootKey("review_intensity"));
  root.max_remediation_rounds = parsePositiveInt(
    expectRootKey("max_remediation_rounds"),
  );

  expectRootKey("acceptance_criteria");
  const criteria: AcceptanceCriterion[] = [];
  while (i < lines.length && lines[i].indent === 2 && lines[i].content.startsWith("- id:")) {
    const id = parseQuotedString(lines[i].content.slice("- id:".length).trim());
    i += 1;
    if (!lines[i]?.content.startsWith("description:")) throw new Error("description");
    const description = parseQuotedString(
      lines[i].content.slice("description:".length).trim(),
    );
    i += 1;
    criteria.push({ id, description });
  }
  root.acceptance_criteria = criteria;

  if (i !== lines.length) {
    throw new Error(`unexpected trailing content at line ${i + 1}`);
  }

  return parseTaskContract(root);
}

export function isCanonicalContractYaml(text: string): boolean {
  try {
    const parsed = parseCanonicalContractYaml(text);
    return formatCanonicalContractYaml(parsed) === text;
  } catch {
    return false;
  }
}

export function assertCanonicalContractYaml(text: string): TaskContract {
  const parsed = parseCanonicalContractYaml(text);
  const canonical = formatCanonicalContractYaml(parsed);
  if (canonical !== text) {
    throw new Error("contract YAML is not in canonical frozen form");
  }
  return parsed;
}
