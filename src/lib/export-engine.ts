import ExcelJS from "exceljs";
import type { ExportColumn, ExportFormatSpec } from "@/lib/export-spec";

export type OfferLine = { rightsType: string; territory: string; windowEnd: string | null };
export type TitleExportInput = {
  catalogId: string;
  title: string;
  metadata: Record<string, unknown>;
  offer: OfferLine[]; // the title's deliveries to the endpoint
};

// "SVOD: US, CA (through 2027) · AVOD: Worldwide" — grouped by rights type.
export function renderOffer(offer: OfferLine[]): string {
  // Group by (rights type, window) so different windows never collapse onto one line.
  const byGroup = new Map<string, { rt: string; win: string | null; terrs: Set<string> }>();
  for (const o of offer) {
    const key = `${o.rightsType}|${o.windowEnd ?? ""}`;
    const g = byGroup.get(key) ?? { rt: o.rightsType, win: o.windowEnd, terrs: new Set<string>() };
    g.terrs.add(o.territory);
    byGroup.set(key, g);
  }
  return [...byGroup.values()]
    .sort((a, b) => a.rt.localeCompare(b.rt) || (a.win ?? "").localeCompare(b.win ?? ""))
    .map((g) => {
      const terrs = [...g.terrs].sort().join(", ");
      const win = g.win ? ` (through ${g.win.slice(0, 10)})` : "";
      return `${g.rt.toUpperCase()}: ${terrs}${win}`;
    })
    .join(" · ");
}

function applyTransform(value: unknown, col: ExportColumn): { text: string; warning?: string } {
  const t = col.transform;
  let out: string;
  if (value === null || value === undefined || value === "") out = "";
  else if (Array.isArray(value)) out = value.join(t?.type === "list_join" ? t.delimiter : ", ");
  else out = String(value);

  if (t?.type === "enum_map") out = t.map[out] ?? out;
  // date_format v1: pass-through ISO (real patterning added when a vendor needs it)

  let warning: string | undefined;
  const cap = col.max_length ?? (t?.type === "truncate" ? t.max : undefined);
  if (cap && out.length > cap) {
    out = out.slice(0, cap);
    warning = `"${col.header}" truncated to ${cap} chars`;
  }
  return { text: out, warning };
}

export function buildExportRows(spec: ExportFormatSpec, titles: TitleExportInput[]): {
  headers: string[];
  rows: string[][];
  warnings: string[];
} {
  const headers = spec.columns.map((c) => c.header);
  const warnings: string[] = [];
  const rows = titles.map((t) =>
    spec.columns.map((col) => {
      let raw: unknown;
      switch (col.source.kind) {
        case "catalog_id": raw = t.catalogId; break;
        case "title": raw = t.title; break;
        case "offer": raw = renderOffer(t.offer); break;
        case "static": raw = col.source.value; break;
        case "field": raw = t.metadata[col.source.key]; break;
      }
      const { text, warning } = applyTransform(raw, col);
      if (
        col.source.kind === "field" &&
        (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0))
      ) {
        warnings.push(`${t.catalogId}: "${col.header}" is blank`);
      }
      if (warning) warnings.push(`${t.catalogId}: ${warning}`);
      return text;
    }),
  );
  return { headers, rows, warnings };
}

export async function toXlsx(headers: string[], rows: string[][], sheetName = "Titles"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
