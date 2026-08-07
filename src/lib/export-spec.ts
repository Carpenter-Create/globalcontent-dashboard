import { z } from "zod";
import { METADATA_FIELDS } from "@/lib/metadata";

const FIELD_KEYS = METADATA_FIELDS.map((f) => f.key) as [string, ...string[]];

const transform = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("number_format"), pattern: z.string().optional() }),
  z.object({ type: z.literal("date_format"), pattern: z.string() }),
  z.object({ type: z.literal("list_join"), delimiter: z.string() }),
  z.object({ type: z.literal("enum_map"), map: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("truncate"), max: z.number().int().positive() }),
]);

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), key: z.enum(FIELD_KEYS) }),
  z.object({ kind: z.literal("catalog_id") }),
  z.object({ kind: z.literal("title") }),
  z.object({ kind: z.literal("offer") }),
  z.object({ kind: z.literal("static"), value: z.string() }),
]);

export const exportColumnSchema = z.object({
  header: z.string().min(1),
  source,
  transform: transform.optional(),
  max_length: z.number().int().positive().optional(),
});
export const exportSpecSchema = z.object({
  format: z.literal("xlsx"),
  sheet_name: z.string().optional(),
  columns: z.array(exportColumnSchema).min(1),
});
export type ExportFormatSpec = z.infer<typeof exportSpecSchema>;
export type ExportColumn = z.infer<typeof exportColumnSchema>;

export function parseExportSpec(raw: unknown): { ok: true; spec: ExportFormatSpec } | { ok: false; error: string } {
  const r = exportSpecSchema.safeParse(raw);
  return r.success ? { ok: true, spec: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid export spec" };
}

// Global Content standard template — DRAFT (founder confirms the exact columns at
// implementation). Used when a vendor has no export_format_spec.
export const STANDARD_EXPORT_TEMPLATE: ExportFormatSpec = {
  format: "xlsx",
  sheet_name: "Titles",
  columns: [
    { header: "Catalog ID", source: { kind: "catalog_id" } },
    { header: "Title", source: { kind: "title" } },
    { header: "Alternate Title", source: { kind: "field", key: "alternate_title" } },
    { header: "Synopsis", source: { kind: "field", key: "synopsis" } },
    { header: "Runtime (min)", source: { kind: "field", key: "runtime_minutes" } },
    { header: "Year", source: { kind: "field", key: "release_year" } },
    { header: "Genre", source: { kind: "field", key: "genre" } },
    { header: "Language", source: { kind: "field", key: "primary_language" } },
    { header: "Country", source: { kind: "field", key: "country_of_origin" } },
    { header: "Director", source: { kind: "field", key: "director" } },
    { header: "Cast", source: { kind: "field", key: "cast" }, transform: { type: "list_join", delimiter: ", " } },
    { header: "Rating", source: { kind: "field", key: "rating" } },
    { header: "Offer", source: { kind: "offer" } },
  ],
};

// Buyer-facing sheet: the standard template minus Offer. A prospective buyer has no offer,
// and listing rights already granted to other endpoints would be actively wrong.
export const BUYER_EXPORT_TEMPLATE: ExportFormatSpec = {
  format: "xlsx",
  sheet_name: "Title",
  columns: [
    { header: "Title", source: { kind: "title" } },
    { header: "Alternate Title", source: { kind: "field", key: "alternate_title" } },
    { header: "Catalog ID", source: { kind: "catalog_id" } },
    { header: "Synopsis", source: { kind: "field", key: "synopsis" } },
    { header: "Runtime (min)", source: { kind: "field", key: "runtime_minutes" } },
    { header: "Year", source: { kind: "field", key: "release_year" } },
    { header: "Genre", source: { kind: "field", key: "genre" } },
    { header: "Language", source: { kind: "field", key: "primary_language" } },
    { header: "Country", source: { kind: "field", key: "country_of_origin" } },
    { header: "Director", source: { kind: "field", key: "director" } },
    { header: "Cast", source: { kind: "field", key: "cast" }, transform: { type: "list_join", delimiter: ", " } },
    { header: "Rating", source: { kind: "field", key: "rating" } },
    { header: "Production Company", source: { kind: "field", key: "production_company" } },
  ],
};
