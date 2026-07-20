import { describe, expect, it } from "vitest";
import { computeMetadataFindings } from "./metadata";

describe("computeMetadataFindings", () => {
  it("empty metadata → all required (high) + recommended (low), no optional", () => {
    const f = computeMetadataFindings({});
    const high = f.filter((x) => x.severity === "high");
    const low = f.filter((x) => x.severity === "low");
    expect(high).toHaveLength(6); // synopsis, runtime_minutes, release_year, genre, primary_language, country_of_origin
    expect(low).toHaveLength(4); // director, cast, rating, keywords
    expect(f.some((x) => x.field === "alternate_title")).toBe(false); // optional never flagged
    expect(f.every((x) => x.code === `metadata.missing.${x.field}`)).toBe(true);
    expect(high.every((x) => x.tier === "required" && x.message.endsWith("is required."))).toBe(true);
    expect(low.every((x) => x.tier === "recommended" && x.message.endsWith("is recommended."))).toBe(true);
  });

  it("fully complete (required + recommended) → no findings", () => {
    const full = {
      synopsis: "A film.", runtime_minutes: 94, release_year: 2026, genre: "drama",
      primary_language: "en", country_of_origin: "US",
      director: "Jo", cast: ["A", "B"], rating: "PG", keywords: ["holiday"],
    };
    expect(computeMetadataFindings(full)).toEqual([]);
  });

  it("partial → exactly the missing subset", () => {
    const f = computeMetadataFindings({ synopsis: "x", genre: "drama" });
    const missing = f.map((x) => x.field).sort();
    expect(missing).toEqual(
      ["cast", "country_of_origin", "director", "keywords", "primary_language", "rating", "release_year", "runtime_minutes"].sort(),
    );
  });

  it("empty-array and blank-string count as missing", () => {
    const f = computeMetadataFindings({ synopsis: "", cast: [], runtime_minutes: 0 });
    expect(f.some((x) => x.field === "synopsis")).toBe(true); // "" is empty
    expect(f.some((x) => x.field === "cast")).toBe(true); // [] is empty
    expect(f.some((x) => x.field === "runtime_minutes")).toBe(false); // 0 is present
  });
});
