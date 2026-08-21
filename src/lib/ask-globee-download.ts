import { ASK_GLOBEE, askGlobeeConversationTitle } from "@/lib/ask-globee";
import { METADATA_FIELDS } from "@/lib/metadata";

// Locked conversation download (440:410 letter sheet, 440:432 filename).
// Client-side PDF — no new dependency; one letter page, Standard 14 fonts.
// Live title + live lead/follow only. Fixture titles are inputs, never baked in.

export const ASK_GLOBEE_DOWNLOAD_CONTENT_TYPE = "application/pdf";

export const ASK_GLOBEE_DOWNLOAD = {
  contentType: ASK_GLOBEE_DOWNLOAD_CONTENT_TYPE,
  brandName: "Global Content",
  attributionName: ASK_GLOBEE.attributionName,
  mark: ASK_GLOBEE.globeeMark,
  pageWidth: 768,
  pageHeight: 1056,
  markSize: 24,
  // Confirmed Sporty Blue — same value as --accent in tokens.css.
  accent: [0x17, 0x69, 0xff] as const,
} as const;

export type AskGlobeeDownloadInkSpan = {
  text: string;
  medium: boolean;
};

export type AskGlobeeDownloadInput = {
  title: string;
  userPrompt: string;
  initials: string;
  lead: string;
  follow: string | null;
};

const PAGE_W = ASK_GLOBEE_DOWNLOAD.pageWidth;
const PAGE_H = ASK_GLOBEE_DOWNLOAD.pageHeight;
const MARGIN = 48;
const MARK = ASK_GLOBEE_DOWNLOAD.markSize;
const GAP = 8;
const BUBBLE_PAD = 16;
const BUBBLE_RADIUS = 14;
const TITLE_SIZE = 28;
const BODY_SIZE = 15;
const HEADER_SIZE = 16;
const ATTR_SIZE = 12;
const LINE = 1.4;

const INK = [0x14, 0x17, 0x1a] as const;
const MUTED = [0xf4, 0xf4, 0xf6] as const;
const WHITE = [0xff, 0xff, 0xff] as const;
const INK_3 = [0x9a, 0xa0, 0xa9] as const;

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

export function askGlobeeDownloadFilename(title: string): string {
  const slug = askGlobeeConversationTitle(title)
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `globee-${slug || "conversation"}.pdf`;
}

export function stackAskGlobeeDownloadFacts(lead: string, follow: string | null): string[] {
  return [lead, follow]
    .flatMap((block) => (block ?? "").split(/\r?\n/))
    .map(stripDownloadBullet)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseAskGlobeeDownloadInk(text: string): AskGlobeeDownloadInkSpan[] {
  const marked = splitMarkdownMedium(stripDownloadBullet(text));
  return marked.flatMap((span) => (span.medium ? [span] : emphasizeCatalogFields(span.text)));
}

export function buildAskGlobeeDownloadPdf(input: AskGlobeeDownloadInput): Uint8Array {
  const title = input.title.trim();
  const userPrompt = input.userPrompt.trim();
  const initials = input.initials.trim().slice(0, 2).toUpperCase();
  const facts = stackAskGlobeeDownloadFacts(input.lead, input.follow);
  const inkLines = facts.map((line) => wrapInk(parseAskGlobeeDownloadInk(line), bodyMaxWidth(), BODY_SIZE));

  const draw = new PdfPage();
  let top = MARGIN;

  drawMark(draw, MARGIN + MARK / 2, top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
  draw.text({
    x: MARGIN + MARK + GAP,
    top: top + 4,
    text: ASK_GLOBEE_DOWNLOAD.brandName,
    size: HEADER_SIZE,
    bold: true,
    rgb: INK,
  });
  top += MARK + 36;

  const titleLines = wrapPlain(title, PAGE_W - MARGIN * 2, TITLE_SIZE, true);
  for (const line of titleLines) {
    draw.text({ x: MARGIN, top, text: line, size: TITLE_SIZE, bold: true, rgb: INK });
    top += TITLE_SIZE * 1.15;
  }
  top += 36;

  const bubbleMax = PAGE_W - MARGIN * 2 - MARK - GAP;
  const promptLines = wrapPlain(userPrompt, bubbleMax - BUBBLE_PAD * 2, BODY_SIZE, false);
  const bubbleW = Math.min(
    bubbleMax,
    Math.max(measurePlain(userPrompt, BODY_SIZE, false) + BUBBLE_PAD * 2, 48),
  );
  const bubbleH = BUBBLE_PAD * 2 + Math.max(promptLines.length, 1) * BODY_SIZE * LINE;

  draw.circle(MARGIN + MARK / 2, top + MARK / 2, MARK / 2, MUTED);
  if (initials) {
    draw.centeredText({
      cx: MARGIN + MARK / 2,
      cyTop: top + MARK / 2,
      text: initials,
      size: 11,
      bold: true,
      rgb: INK,
    });
  }
  draw.roundedRect(MARGIN + MARK + GAP, top, bubbleW, bubbleH, BUBBLE_RADIUS, MUTED);
  let promptTop = top + BUBBLE_PAD;
  for (const line of promptLines) {
    draw.text({
      x: MARGIN + MARK + GAP + BUBBLE_PAD,
      top: promptTop,
      text: line,
      size: BODY_SIZE,
      bold: false,
      rgb: INK,
    });
    promptTop += BODY_SIZE * LINE;
  }
  top += bubbleH + 32;

  drawMark(draw, MARGIN + MARK / 2, top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
  let inkTop = top;
  const inkX = MARGIN + MARK + GAP;
  for (const [factIndex, wrapped] of inkLines.entries()) {
    if (factIndex > 0) inkTop += BODY_SIZE * 0.55;
    for (const row of wrapped) {
      draw.inkRow(inkX, inkTop, row, BODY_SIZE, INK);
      inkTop += BODY_SIZE * LINE;
    }
  }
  inkTop += 10;
  draw.text({
    x: inkX,
    top: inkTop,
    text: ASK_GLOBEE_DOWNLOAD.attributionName,
    size: ATTR_SIZE,
    bold: false,
    rgb: INK_3,
  });

  return assemblePdf(draw.toStream());
}

function bodyMaxWidth(): number {
  return PAGE_W - MARGIN * 2 - MARK - GAP;
}

function stripDownloadBullet(text: string): string {
  return text.replace(/^\s*(?:[-*•]|\d+\.)\s+/, "");
}

function splitMarkdownMedium(text: string): AskGlobeeDownloadInkSpan[] {
  const spans: AskGlobeeDownloadInkSpan[] = [];
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
  return spans.filter((span) => span.text.length > 0);
}

function emphasizeCatalogFields(text: string): AskGlobeeDownloadInkSpan[] {
  const spans: AskGlobeeDownloadInkSpan[] = [];
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

function wrapPlain(text: string, maxWidth: number, size: number, bold: boolean): string[] {
  if (!text) return [];
  return wrapTokens(text.split(/(\s+)/), maxWidth, size, bold);
}

function wrapInk(spans: AskGlobeeDownloadInkSpan[], maxWidth: number, size: number): AskGlobeeDownloadInkSpan[][] {
  const lines: AskGlobeeDownloadInkSpan[][] = [[]];
  let used = 0;
  for (const span of spans) {
    const tokens = span.text.split(/(\s+)/);
    for (const token of tokens) {
      if (!token) continue;
      const width = measurePlain(token, size, span.medium);
      if (used > 0 && used + width > maxWidth && !/^\s+$/.test(token)) {
        lines.push([]);
        used = 0;
      }
      const line = lines[lines.length - 1];
      const prev = line[line.length - 1];
      if (prev && prev.medium === span.medium) {
        prev.text += token;
      } else {
        line.push({ text: token, medium: span.medium });
      }
      used += width;
    }
  }
  return lines.filter((line) => line.some((span) => span.text.trim().length > 0));
}

function wrapTokens(tokens: string[], maxWidth: number, size: number, bold: boolean): string[] {
  const lines: string[] = [""];
  let used = 0;
  for (const token of tokens) {
    if (!token) continue;
    const width = measurePlain(token, size, bold);
    if (used > 0 && used + width > maxWidth && !/^\s+$/.test(token)) {
      lines.push("");
      used = 0;
    }
    lines[lines.length - 1] += token;
    used += width;
  }
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

function measurePlain(text: string, size: number, bold: boolean): number {
  let width = 0;
  for (const char of text) {
    width += glyphWidth(char) * (bold ? 1.08 : 1);
  }
  return (width * size) / 1000;
}

function glyphWidth(char: string): number {
  const code = char.charCodeAt(0);
  if (code === 32) return 278;
  if (/[iltfI.,:'!]/.test(char)) return 278;
  if (/[mwMW@]/.test(char)) return 833;
  return 556;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rgbOp(rgb: readonly [number, number, number]): string {
  return rgb.map((channel) => (channel / 255).toFixed(4)).join(" ");
}

function pdfY(top: number, size = 0): number {
  return PAGE_H - top - size;
}

function escapePdf(text: string): string {
  const winAnsi = Array.from(text, (char) => {
    switch (char) {
      case "\u2014":
        return "\x97";
      case "\u2013":
        return "\x96";
      case "\u2018":
      case "\u2019":
        return "'";
      case "\u201c":
      case "\u201d":
        return '"';
      case "\u2026":
        return "...";
      default:
        return char.charCodeAt(0) > 255 ? "?" : char;
    }
  }).join("");
  return winAnsi.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

class PdfPage {
  private readonly ops: string[] = [];

  circle(cx: number, cyTop: number, r: number, rgb: readonly [number, number, number]) {
    const cy = pdfY(cyTop);
    const k = 0.5522847498 * r;
    this.ops.push(`${rgbOp(rgb)} rg`);
    this.ops.push(`${fmt(cx + r)} ${fmt(cy)} m`);
    this.ops.push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`);
    this.ops.push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`);
    this.ops.push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`);
    this.ops.push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`);
    this.ops.push("f");
  }

  roundedRect(
    x: number,
    top: number,
    w: number,
    h: number,
    r: number,
    rgb: readonly [number, number, number],
  ) {
    const radius = Math.min(r, w / 2, h / 2);
    const y = pdfY(top + h);
    const k = 0.5522847498 * radius;
    this.ops.push(`${rgbOp(rgb)} rg`);
    this.ops.push(`${fmt(x + radius)} ${fmt(y)} m`);
    this.ops.push(`${fmt(x + w - radius)} ${fmt(y)} l`);
    this.ops.push(
      `${fmt(x + w - radius + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + radius - k)} ${fmt(x + w)} ${fmt(y + radius)} c`,
    );
    this.ops.push(`${fmt(x + w)} ${fmt(y + h - radius)} l`);
    this.ops.push(
      `${fmt(x + w)} ${fmt(y + h - radius + k)} ${fmt(x + w - radius + k)} ${fmt(y + h)} ${fmt(x + w - radius)} ${fmt(y + h)} c`,
    );
    this.ops.push(`${fmt(x + radius)} ${fmt(y + h)} l`);
    this.ops.push(
      `${fmt(x + radius - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - radius + k)} ${fmt(x)} ${fmt(y + h - radius)} c`,
    );
    this.ops.push(`${fmt(x)} ${fmt(y + radius)} l`);
    this.ops.push(
      `${fmt(x)} ${fmt(y + radius - k)} ${fmt(x + radius - k)} ${fmt(y)} ${fmt(x + radius)} ${fmt(y)} c`,
    );
    this.ops.push("f");
  }

  text(input: {
    x: number;
    top: number;
    text: string;
    size: number;
    bold: boolean;
    rgb: readonly [number, number, number];
  }) {
    const font = input.bold ? "F2" : "F1";
    this.ops.push("BT");
    this.ops.push(`/${font} ${fmt(input.size)} Tf`);
    this.ops.push(`${rgbOp(input.rgb)} rg`);
    this.ops.push(`${fmt(input.x)} ${fmt(pdfY(input.top, input.size * 0.8))} Td`);
    this.ops.push(`(${escapePdf(input.text)}) Tj`);
    this.ops.push("ET");
  }

  centeredText(input: {
    cx: number;
    cyTop: number;
    text: string;
    size: number;
    bold: boolean;
    rgb: readonly [number, number, number];
  }) {
    const width = measurePlain(input.text, input.size, input.bold);
    this.text({
      x: input.cx - width / 2,
      top: input.cyTop - input.size * 0.38,
      text: input.text,
      size: input.size,
      bold: input.bold,
      rgb: input.rgb,
    });
  }

  inkRow(
    x: number,
    top: number,
    spans: AskGlobeeDownloadInkSpan[],
    size: number,
    rgb: readonly [number, number, number],
  ) {
    this.ops.push("BT");
    this.ops.push(`${rgbOp(rgb)} rg`);
    this.ops.push(`${fmt(x)} ${fmt(pdfY(top, size * 0.8))} Td`);
    for (const span of spans) {
      this.ops.push(`/${span.medium ? "F2" : "F1"} ${fmt(size)} Tf`);
      this.ops.push(`(${escapePdf(span.text)}) Tj`);
    }
    this.ops.push("ET");
  }

  toStream(): string {
    return `${this.ops.join("\n")}\n`;
  }
}

function drawMark(
  draw: PdfPage,
  cx: number,
  cyTop: number,
  fill: readonly [number, number, number],
  ink: readonly [number, number, number],
  mark: string,
) {
  draw.circle(cx, cyTop, MARK / 2, fill);
  draw.centeredText({ cx, cyTop, text: mark, size: 11, bold: true, rgb: ink });
}

function fmt(value: number): string {
  return value.toFixed(2);
}

function assemblePdf(content: string): Uint8Array {
  const fonts = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    fonts[0],
    fonts[1],
  ];
  const header = "%PDF-1.4\n";
  const chunks = [header];
  const offsets = [0];
  let cursor = header.length;
  objects.forEach((body, index) => {
    const object = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets[index + 1] = cursor;
    chunks.push(object);
    cursor += object.length;
  });
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(xref, trailer);
  const source = chunks.join("");
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    bytes[index] = source.charCodeAt(index) & 0xff;
  }
  return bytes;
}
