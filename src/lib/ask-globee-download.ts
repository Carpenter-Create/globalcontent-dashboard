import { ASK_GLOBEE, askGlobeeConversationTitle } from "@/lib/ask-globee";
import {
  parseAskGlobeeDownloadInk,
  stackAskGlobeeDownloadFacts,
  type AskGlobeeDownloadInkSpan,
} from "@/lib/ask-globee-ink";

export {
  parseAskGlobeeDownloadInk,
  stackAskGlobeeDownloadFacts,
  type AskGlobeeDownloadInkSpan,
} from "@/lib/ask-globee-ink";

// Locked conversation download (440:410 letter sheet, 440:432 filename).
// Client-side PDF — no new dependency; letter pages, Standard 14 fonts.
// Live title + the full thread. Fixture titles are inputs, never baked in.
// Overflow paginates; turns are not dropped.

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

export type AskGlobeeDownloadMessage = {
  role: "user" | "globee";
  body: string;
  lead?: string | null;
  follow?: string | null;
};

export type AskGlobeeDownloadInput = {
  title: string;
  initials: string;
  userPrompt?: string;
  lead?: string;
  follow?: string | null;
  messages?: AskGlobeeDownloadMessage[];
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
const AFTER_BRAND = 36;
const AFTER_BRAND_CONTINUE = 24;
const AFTER_TITLE = 36;
const AFTER_USER = 32;
const AFTER_TURN = 24;

const INK = [0x14, 0x17, 0x1a] as const;
const MUTED = [0xf4, 0xf4, 0xf6] as const;
const WHITE = [0xff, 0xff, 0xff] as const;
const INK_3 = [0x9a, 0xa0, 0xa9] as const;

export function askGlobeeDownloadFilename(title: string): string {
  const slug = askGlobeeConversationTitle(title)
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `globee-${slug || "conversation"}.pdf`;
}

export function askGlobeeDownloadBlob(input: AskGlobeeDownloadInput): Blob {
  const bytes = buildAskGlobeeDownloadPdf(input);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: ASK_GLOBEE_DOWNLOAD_CONTENT_TYPE });
}

export function saveAskGlobeeDownload(input: AskGlobeeDownloadInput): void {
  const blob = askGlobeeDownloadBlob(input);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = askGlobeeDownloadFilename(input.title);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildAskGlobeeDownloadPdf(input: AskGlobeeDownloadInput): Uint8Array {
  const title = input.title.trim();
  const initials = input.initials.trim().slice(0, 2).toUpperCase();
  const messages = resolveDownloadMessages(input);
  const doc = new PdfDocument();

  const titleLines = wrapPlain(title, PAGE_W - MARGIN * 2, TITLE_SIZE, true);
  for (const line of titleLines) {
    doc.ensure(TITLE_SIZE * 1.15);
    doc.page.text({ x: MARGIN, top: doc.top, text: line, size: TITLE_SIZE, bold: true, rgb: INK });
    doc.top += TITLE_SIZE * 1.15;
    doc.usedContent = true;
  }
  if (titleLines.length > 0) doc.top += AFTER_TITLE;

  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      drawUserCard(doc, initials, message.body);
      continue;
    }
    drawGlobeeTurn(doc, message);
    if (messages[index + 1]) doc.top += AFTER_TURN;
  }

  return assemblePdf(doc.streams());
}

function resolveDownloadMessages(input: AskGlobeeDownloadInput): AskGlobeeDownloadMessage[] {
  if (input.messages) return input.messages;
  const messages: AskGlobeeDownloadMessage[] = [];
  if ((input.userPrompt ?? "").trim()) {
    messages.push({ role: "user", body: input.userPrompt ?? "" });
  }
  if ((input.lead ?? "").trim() || (input.follow ?? "").trim()) {
    messages.push({
      role: "globee",
      body: input.lead ?? "",
      lead: input.lead,
      follow: input.follow ?? null,
    });
  }
  return messages;
}

function drawUserCard(doc: PdfDocument, initials: string, prompt: string) {
  const bubbleMax = bodyMaxWidth();
  const promptLines = wrapPlain(prompt.trim(), bubbleMax - BUBBLE_PAD * 2, BODY_SIZE, false);
  const lines = promptLines.length > 0 ? promptLines : [""];
  const bubbleW = Math.min(
    bubbleMax,
    Math.max(measurePlain(prompt.trim() || " ", BODY_SIZE, false) + BUBBLE_PAD * 2, 48),
  );
  const lineH = BODY_SIZE * LINE;
  const bubbleH = BUBBLE_PAD * 2 + lines.length * lineH;
  doc.ensure(Math.min(bubbleH, MARK + BUBBLE_PAD));

  let lineIndex = 0;
  let firstFragment = true;
  while (lineIndex < lines.length) {
    const padTop = firstFragment ? BUBBLE_PAD : GAP;
    const available = doc.remaining() - padTop - GAP;
    const fit = Math.max(1, Math.min(lines.length - lineIndex, Math.floor(available / lineH)));
    const fragment = lines.slice(lineIndex, lineIndex + fit);
    const fragmentH = padTop + GAP + fragment.length * lineH;
    if (firstFragment) {
      doc.page.circle(MARGIN + MARK / 2, doc.top + MARK / 2, MARK / 2, MUTED);
      if (initials) {
        doc.page.centeredText({
          cx: MARGIN + MARK / 2,
          cyTop: doc.top + MARK / 2,
          text: initials,
          size: 11,
          bold: true,
          rgb: INK,
        });
      }
    }
    doc.page.roundedRect(MARGIN + MARK + GAP, doc.top, bubbleW, fragmentH, BUBBLE_RADIUS, MUTED);
    let promptTop = doc.top + padTop;
    for (const line of fragment) {
      if (line) {
        doc.page.text({
          x: MARGIN + MARK + GAP + BUBBLE_PAD,
          top: promptTop,
          text: line,
          size: BODY_SIZE,
          bold: false,
          rgb: INK,
        });
      }
      promptTop += lineH;
    }
    doc.top += fragmentH;
    doc.usedContent = true;
    lineIndex += fit;
    firstFragment = false;
    if (lineIndex < lines.length) doc.newPage();
  }
  doc.top += AFTER_USER;
}

function drawGlobeeTurn(doc: PdfDocument, message: AskGlobeeDownloadMessage) {
  const lead = (message.lead ?? message.body).trim();
  const follow = message.follow ?? null;
  const facts = stackAskGlobeeDownloadFacts(lead, follow);
  const inkLines = facts.map((line) => wrapInk(parseAskGlobeeDownloadInk(line), bodyMaxWidth(), BODY_SIZE));
  const rows = inkLines.flatMap((wrapped, factIndex) =>
    wrapped.map((row, rowIndex) => ({ row, gapBefore: factIndex > 0 && rowIndex === 0 })),
  );
  const inkX = MARGIN + MARK + GAP;
  const lineH = BODY_SIZE * LINE;
  let markPending = true;

  if (rows.length === 0) {
    doc.ensure(MARK);
    drawMark(doc.page, MARGIN + MARK / 2, doc.top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
    markPending = false;
    doc.top += MARK;
    doc.usedContent = true;
  }

  for (const { row, gapBefore } of rows) {
    const needed = (gapBefore ? BODY_SIZE * 0.55 : 0) + lineH;
    if (needed > doc.remaining() && doc.usedContent) {
      doc.newPage();
      markPending = true;
    }
    if (gapBefore) doc.top += BODY_SIZE * 0.55;
    if (markPending) {
      drawMark(doc.page, MARGIN + MARK / 2, doc.top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
      markPending = false;
    }
    doc.page.inkRow(inkX, doc.top, row, BODY_SIZE, INK);
    doc.top += lineH;
    doc.usedContent = true;
  }

  if (10 + ATTR_SIZE > doc.remaining() && doc.usedContent) {
    doc.newPage();
    markPending = true;
  }
  doc.top += 10;
  if (markPending) {
    drawMark(doc.page, MARGIN + MARK / 2, doc.top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
    markPending = false;
  }
  doc.page.text({
    x: inkX,
    top: doc.top,
    text: ASK_GLOBEE_DOWNLOAD.attributionName,
    size: ATTR_SIZE,
    bold: false,
    rgb: INK_3,
  });
  doc.top += ATTR_SIZE;
  doc.usedContent = true;
}

function bodyMaxWidth(): number {
  return PAGE_W - MARGIN * 2 - MARK - GAP;
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

class PdfDocument {
  readonly pages: PdfPage[] = [];
  page: PdfPage;
  top = MARGIN;
  usedContent = false;

  constructor() {
    this.page = this.startPage();
  }

  remaining(): number {
    return PAGE_H - MARGIN - this.top;
  }

  ensure(height: number) {
    if (height <= this.remaining()) return;
    if (this.usedContent) this.newPage();
  }

  newPage() {
    this.page = this.startPage();
  }

  streams(): string[] {
    return this.pages.map((page) => page.toStream());
  }

  private startPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    this.top = MARGIN;
    this.usedContent = false;
    drawMark(page, MARGIN + MARK / 2, this.top + MARK / 2, ASK_GLOBEE_DOWNLOAD.accent, WHITE, ASK_GLOBEE_DOWNLOAD.mark);
    page.text({
      x: MARGIN + MARK + GAP,
      top: this.top + 4,
      text: ASK_GLOBEE_DOWNLOAD.brandName,
      size: HEADER_SIZE,
      bold: true,
      rgb: INK,
    });
    this.top += MARK + (this.pages.length === 1 ? AFTER_BRAND : AFTER_BRAND_CONTINUE);
    return page;
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

function assemblePdf(pageStreams: string[]): Uint8Array {
  const streams = pageStreams.length > 0 ? pageStreams : [""];
  const pageCount = streams.length;
  const fonts = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const font1 = 3 + 2 * pageCount;
  const font2 = 4 + 2 * pageCount;
  const kids = streams.map((_, index) => `${3 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
  ];
  streams.forEach((_, index) => {
    const contentObj = 3 + pageCount + index;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`,
    );
  });
  for (const content of streams) {
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  }
  objects.push(fonts[0], fonts[1]);
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
