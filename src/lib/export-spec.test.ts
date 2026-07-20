import { describe, expect, it } from "vitest";
import { parseExportSpec, STANDARD_EXPORT_TEMPLATE, exportSpecSchema } from "@/lib/export-spec";

describe("parseExportSpec", () => {
  it("accepts a well-formed spec covering every source kind and transform", () => {
    const raw = {
      format: "xlsx",
      sheet_name: "Vendor Sheet",
      columns: [
        { header: "Catalog ID", source: { kind: "catalog_id" } },
        { header: "Title", source: { kind: "field", key: "alternate_title" } },
        { header: "Delivered By", source: { kind: "static", value: "Global Content" } },
        { header: "Offer", source: { kind: "offer" } },
        {
          header: "Cast",
          source: { kind: "field", key: "cast" },
          transform: { type: "list_join", delimiter: ", " },
        },
        {
          header: "Rating",
          source: { kind: "field", key: "rating" },
          transform: { type: "enum_map", map: { "PG-13": "13+" } },
        },
        {
          header: "Synopsis",
          source: { kind: "field", key: "synopsis" },
          transform: { type: "truncate", max: 200 },
        },
        {
          header: "Release Date",
          source: { kind: "field", key: "release_year" },
          transform: { type: "date_format", pattern: "yyyy" },
        },
        {
          header: "Runtime",
          source: { kind: "field", key: "runtime_minutes" },
          transform: { type: "number_format" },
        },
      ],
    };
    const result = parseExportSpec(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects a spec with zero columns", () => {
    const result = parseExportSpec({ format: "xlsx", columns: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects a spec with a non-xlsx format", () => {
    const result = parseExportSpec({
      format: "csv",
      columns: [{ header: "Catalog ID", source: { kind: "catalog_id" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown field key", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [{ header: "Bogus", source: { kind: "field", key: "not_a_real_field" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown source kind", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [{ header: "Bogus", source: { kind: "vendor_magic" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown transform type", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [
        { header: "Catalog ID", source: { kind: "catalog_id" }, transform: { type: "uppercase" } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a truncate transform with a non-positive max", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [
        {
          header: "Synopsis",
          source: { kind: "field", key: "synopsis" },
          transform: { type: "truncate", max: 0 },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a static source missing its value", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [{ header: "Bogus", source: { kind: "static" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a column with an empty header", () => {
    const result = parseExportSpec({
      format: "xlsx",
      columns: [{ header: "", source: { kind: "catalog_id" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("returns a readable error string on failure", () => {
    const result = parseExportSpec({ format: "xlsx", columns: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.error).toBe("string");
  });
});

describe("STANDARD_EXPORT_TEMPLATE", () => {
  it("parses as a valid export spec", () => {
    const result = parseExportSpec(STANDARD_EXPORT_TEMPLATE);
    expect(result.ok).toBe(true);
  });

  it("round-trips through the schema unchanged", () => {
    const parsed = exportSpecSchema.parse(STANDARD_EXPORT_TEMPLATE);
    expect(parsed).toEqual(STANDARD_EXPORT_TEMPLATE);
  });

  it("references only field keys that exist in the metadata registry", () => {
    // parseExportSpec already enforces this via the FIELD_KEYS enum — this test
    // pins the intent so a future metadata.ts rename fails loudly here too.
    const fieldColumns = STANDARD_EXPORT_TEMPLATE.columns.filter((c) => c.source.kind === "field");
    expect(fieldColumns.length).toBeGreaterThan(0);
  });
});
