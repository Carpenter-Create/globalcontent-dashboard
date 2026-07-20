import { describe, expect, it } from "vitest";
import { buildExportRows, renderOffer, toXlsx, type OfferLine, type TitleExportInput } from "@/lib/export-engine";
import type { ExportFormatSpec } from "@/lib/export-spec";

describe("renderOffer", () => {
  it("groups multiple territories under one rights type, sorted, no window", () => {
    const offer: OfferLine[] = [
      { rightsType: "svod", territory: "US", windowEnd: null },
      { rightsType: "svod", territory: "CA", windowEnd: null },
    ];
    expect(renderOffer(offer)).toBe("SVOD: CA, US");
  });

  it("appends the window when present, dated to a 10-char ISO slice", () => {
    const offer: OfferLine[] = [
      { rightsType: "svod", territory: "US", windowEnd: "2027-01-01T00:00:00Z" },
    ];
    expect(renderOffer(offer)).toBe("SVOD: US (through 2027-01-01)");
  });

  it("joins multiple rights types with the middle dot separator, sorted by rights type", () => {
    const offer: OfferLine[] = [
      { rightsType: "svod", territory: "US", windowEnd: null },
      { rightsType: "avod", territory: "WW", windowEnd: null },
    ];
    expect(renderOffer(offer)).toBe("AVOD: WW · SVOD: US");
  });

  it("returns empty string for no offer lines", () => {
    expect(renderOffer([])).toBe("");
  });

  it("orders rights-type groups deterministically regardless of input order", () => {
    const avodFirst: OfferLine[] = [
      { rightsType: "avod", territory: "WW", windowEnd: null },
      { rightsType: "svod", territory: "US", windowEnd: null },
    ];
    const svodFirst: OfferLine[] = [
      { rightsType: "svod", territory: "US", windowEnd: null },
      { rightsType: "avod", territory: "WW", windowEnd: null },
    ];
    expect(renderOffer(avodFirst)).toBe("AVOD: WW · SVOD: US");
    expect(renderOffer(svodFirst)).toBe("AVOD: WW · SVOD: US");
    expect(renderOffer(avodFirst)).toBe(renderOffer(svodFirst));
  });
});

function title(overrides: Partial<TitleExportInput> = {}): TitleExportInput {
  return {
    catalogId: "GC-0000001",
    metadata: {},
    offer: [],
    ...overrides,
  };
}

describe("buildExportRows", () => {
  it("produces headers matching column order and one row per title", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [
        { header: "Catalog ID", source: { kind: "catalog_id" } },
        { header: "Genre", source: { kind: "field", key: "genre" } },
      ],
    };
    const { headers, rows } = buildExportRows(spec, [
      title({ catalogId: "GC-0000001", metadata: { genre: "drama" } }),
      title({ catalogId: "GC-0000002", metadata: { genre: "comedy" } }),
    ]);
    expect(headers).toEqual(["Catalog ID", "Genre"]);
    expect(rows).toEqual([
      ["GC-0000001", "drama"],
      ["GC-0000002", "comedy"],
    ]);
  });

  it("resolves catalog_id from the title, not metadata", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Catalog ID", source: { kind: "catalog_id" } }],
    };
    const { rows } = buildExportRows(spec, [title({ catalogId: "GC-0000042" })]);
    expect(rows).toEqual([["GC-0000042"]]);
  });

  it("resolves a static column to its literal value regardless of title data", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Delivered By", source: { kind: "static", value: "Global Content" } }],
    };
    const { rows } = buildExportRows(spec, [title()]);
    expect(rows).toEqual([["Global Content"]]);
  });

  it("resolves an offer column via renderOffer", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Offer", source: { kind: "offer" } }],
    };
    const { rows } = buildExportRows(spec, [
      title({
        offer: [
          { rightsType: "svod", territory: "US", windowEnd: null },
          { rightsType: "svod", territory: "CA", windowEnd: null },
        ],
      }),
    ]);
    expect(rows).toEqual([["SVOD: CA, US"]]);
  });

  it("applies list_join with the configured delimiter", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [
        { header: "Cast", source: { kind: "field", key: "cast" }, transform: { type: "list_join", delimiter: ", " } },
      ],
    };
    const { rows } = buildExportRows(spec, [title({ metadata: { cast: ["Alice", "Bob"] } })]);
    expect(rows).toEqual([["Alice, Bob"]]);
  });

  it("applies enum_map, falling back to the raw value for unmapped entries", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [
        {
          header: "Rating",
          source: { kind: "field", key: "rating" },
          transform: { type: "enum_map", map: { "PG-13": "13+" } },
        },
      ],
    };
    const { rows } = buildExportRows(spec, [
      title({ metadata: { rating: "PG-13" } }),
      title({ metadata: { rating: "NR" } }),
    ]);
    expect(rows).toEqual([["13+"], ["NR"]]);
  });

  it("truncates a value over max_length and emits a warning", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Synopsis", source: { kind: "field", key: "synopsis" }, max_length: 5 }],
    };
    const { rows, warnings } = buildExportRows(spec, [
      title({ catalogId: "GC-0000001", metadata: { synopsis: "A long synopsis" } }),
    ]);
    expect(rows).toEqual([["A lon"]]);
    expect(warnings).toEqual([`GC-0000001: "Synopsis" truncated to 5 chars`]);
  });

  it("truncates via a truncate transform's max when max_length is absent", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [
        { header: "Synopsis", source: { kind: "field", key: "synopsis" }, transform: { type: "truncate", max: 3 } },
      ],
    };
    const { rows, warnings } = buildExportRows(spec, [title({ catalogId: "GC-0000001", metadata: { synopsis: "Hello" } })]);
    expect(rows).toEqual([["Hel"]]);
    expect(warnings).toEqual([`GC-0000001: "Synopsis" truncated to 3 chars`]);
  });

  it("emits a blank warning for a missing field value and leaves the cell empty", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Director", source: { kind: "field", key: "director" } }],
    };
    const { rows, warnings } = buildExportRows(spec, [title({ catalogId: "GC-0000001", metadata: {} })]);
    expect(rows).toEqual([[""]]);
    expect(warnings).toEqual([`GC-0000001: "Director" is blank`]);
  });

  it("emits a blank warning for an empty-array field value and leaves the cell empty", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Cast", source: { kind: "field", key: "cast" } }],
    };
    const { rows, warnings } = buildExportRows(spec, [
      title({ catalogId: "GC-0000001", metadata: { cast: [] } }),
    ]);
    expect(rows).toEqual([[""]]);
    expect(warnings).toEqual([`GC-0000001: "Cast" is blank`]);
  });

  it("does not emit a blank warning for non-field sources even when empty", () => {
    const spec: ExportFormatSpec = {
      format: "xlsx",
      columns: [{ header: "Offer", source: { kind: "offer" } }],
    };
    const { warnings } = buildExportRows(spec, [title({ offer: [] })]);
    expect(warnings).toEqual([]);
  });
});

describe("toXlsx", () => {
  it("returns a Buffer containing a valid xlsx workbook", async () => {
    const buf = await toXlsx(["Catalog ID", "Genre"], [["GC-0000001", "drama"]], "Titles");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // xlsx files are zip archives — "PK" magic bytes at the start.
    expect(buf.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});
