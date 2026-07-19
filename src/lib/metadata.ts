import { z } from "zod";
import { ISO_COUNTRIES } from "@/lib/territories";
import { LANGUAGES } from "@/lib/languages";

export type Tier = "required" | "recommended" | "optional";
export type FieldType = "text" | "textarea" | "number" | "select" | "list";
export type FieldDef = {
  key: string;
  label: string;
  tier: Tier;
  type: FieldType;
  vocab?: { value: string; label: string }[]; // for `select`
};

// Provisional genre + rating vocabularies (Option B — swap when vendors confirm).
export const GENRES: { value: string; label: string }[] = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance",
  "Sci-Fi", "Sport", "Thriller", "War", "Western",
].map((g) => ({ value: g.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: g }));

export const RATINGS: { value: string; label: string }[] = [
  "G", "PG", "PG-13", "R", "NC-17", "NR",
].map((r) => ({ value: r, label: r }));

const COUNTRIES = Object.entries(ISO_COUNTRIES).map(([value, label]) => ({ value, label }));

// THE canonical field registry — single source for the form AND the validator.
export const METADATA_FIELDS: FieldDef[] = [
  { key: "synopsis", label: "Synopsis", tier: "required", type: "textarea" },
  { key: "runtime_minutes", label: "Runtime (minutes)", tier: "required", type: "number" },
  { key: "release_year", label: "Release year", tier: "required", type: "number" },
  { key: "genre", label: "Genre", tier: "required", type: "select", vocab: GENRES },
  { key: "primary_language", label: "Primary language", tier: "required", type: "select", vocab: LANGUAGES },
  { key: "country_of_origin", label: "Country of origin", tier: "required", type: "select", vocab: COUNTRIES },
  { key: "director", label: "Director", tier: "recommended", type: "text" },
  { key: "cast", label: "Cast", tier: "recommended", type: "list" },
  { key: "rating", label: "Rating", tier: "recommended", type: "select", vocab: RATINGS },
  { key: "keywords", label: "Keywords", tier: "recommended", type: "list" },
  { key: "alternate_title", label: "Alternate title", tier: "optional", type: "text" },
  { key: "production_company", label: "Production company", tier: "optional", type: "text" },
];

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.type) {
    case "number":
      return z.number().int().nonnegative();
    case "list":
      return z.array(z.string().min(1));
    case "select": {
      const values = (f.vocab ?? []).map((v) => v.value);
      return z.enum(values as [string, ...string[]]);
    }
    default: // text, textarea
      return z.string().min(1);
  }
}

// All fields optional → partial drafts are valid; provided fields are type/vocab
// checked. Unknown keys are stripped (zod object default). "The validator decides."
export const metadataSchema = z.object(
  Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, fieldSchema(f).optional()])),
);

export type MetadataData = z.infer<typeof metadataSchema>;

export function parseMetadata(
  input: unknown,
): { ok: true; data: MetadataData } | { ok: false; error: string } {
  const r = metadataSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: `${first.path.join(".") || "field"}: ${first.message}` };
}

// Required-tier completeness — drives the detail-page summary and (later) the
// delivery gate. A field counts as filled if present and non-empty.
export function requiredComplete(data: Record<string, unknown>): { filled: number; total: number } {
  const req = METADATA_FIELDS.filter((f) => f.tier === "required");
  const filled = req.filter((f) => {
    const v = data?.[f.key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== "";
  }).length;
  return { filled, total: req.length };
}
