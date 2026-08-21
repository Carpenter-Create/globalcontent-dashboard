import { METADATA_FIELDS } from "@/lib/metadata";

// Conversation ink for Ask Globee answers. Shared by the 247:295 thread and
// the 440:410 PDF so Medium catalog fields and stacked facts stay consistent.
// Visible ink never shows raw **, #, backticks, or bullets.

export type AskGlobeeInkSpan = {
  text: string;
  medium: boolean;
};

export type AskGlobeeDownloadInkSpan = AskGlobeeInkSpan;

const CATALOG_FIELD_NAMES = [
  ...METADATA_FIELDS.map((field) => field.label),
  "Runtime",
]
  .filter((name, index, all) => name.length > 1 && all.indexOf(name) === index)
  .sort((a, b) => b.length - a.length);

const CATALOG_FIELD_RE = new RegExp(
  `\\b(${CATALOG_FIELD_NAMES.map(escapeRegExp).join("|")})\\b`,
  "g",
);

export function stackAskGlobeeInkFacts(lead: string, follow: string | null): string[] {
  return [lead, follow]
    .flatMap((block) => (block ?? "").split(/\r?\n/))
    .map(stripInkLine)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseAskGlobeeInk(text: string): AskGlobeeInkSpan[] {
  const marked = splitMarkdownMedium(stripInkLine(text));
  return marked.flatMap((span) => (span.medium ? [span] : emphasizeCatalogFields(span.text)));
}

export const stackAskGlobeeDownloadFacts = stackAskGlobeeInkFacts;
export const parseAskGlobeeDownloadInk = parseAskGlobeeInk;

function stripInkLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "");
}

function stripResidualMarkdown(text: string): string {
  return text.replace(/[*#`]+/g, "");
}

function splitMarkdownMedium(text: string): AskGlobeeInkSpan[] {
  const spans: AskGlobeeInkSpan[] = [];
  const marked = /\*\*([\s\S]+?)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(marked)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      spans.push({ text: text.slice(cursor, start), medium: false });
    }
    spans.push({ text: match[1] ?? "", medium: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), medium: false });
  }
  return spans
    .map((span) => ({ ...span, text: stripResidualMarkdown(span.text) }))
    .filter((span) => span.text.length > 0);
}

function emphasizeCatalogFields(text: string): AskGlobeeInkSpan[] {
  const spans: AskGlobeeInkSpan[] = [];
  let cursor = 0;
  CATALOG_FIELD_RE.lastIndex = 0;
  for (const match of text.matchAll(CATALOG_FIELD_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      spans.push({ text: text.slice(cursor, start), medium: false });
    }
    spans.push({ text: match[0], medium: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), medium: false });
  }
  return spans.filter((span) => span.text.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
