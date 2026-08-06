// Filename for a metadata export. The recipient segment names WHICH TEMPLATE the sheet
// follows, which is how the official vendor exports are told apart at a glance.
//
// slugSegment is a security boundary, not tidiness: these segments reach a
// Content-Disposition header, so raw CRLF would let a caller inject headers.
const MAX_SEGMENT = 60;

export function slugSegment(raw: string | null | undefined, fallback: string): string {
  const slug = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // everything else, including / \ " CR LF, becomes a hyphen
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/g, ""); // slicing may have left a trailing hyphen
  return slug || fallback;
}

export function buildExportFilename(input: {
  catalogId: string;
  title: string;
  date: Date;
  recipient?: string | null;
}): string {
  const cat = slugSegment(input.catalogId, "untitled").toUpperCase();
  const title = slugSegment(input.title, "untitled");
  const day = input.date.toISOString().slice(0, 10);
  const recipient = slugSegment(input.recipient, "global_content");
  return `${cat}_${title}_${day}_${recipient}.xlsx`;
}
