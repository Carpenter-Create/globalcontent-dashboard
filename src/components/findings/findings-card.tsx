import { Card, CardBody } from "@/components/ui/card";
import { FINDING_SEVERITY_LABEL } from "@/lib/findings";

// Shared findings render. One entity's open findings as message + severity-label rows.
// Used in-context on both title-detail pages and (via FindingRows) in the Catalog Health
// overview — so the "open findings + severity label" pattern lives in one place.
export type Finding = { id: string; message: string; severity: string };

export function FindingRows({ findings }: { findings: Finding[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {findings.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-3 t-body-sm">
          <span className="text-ink-2">{f.message}</span>
          <span className="shrink-0 t-label text-ink-3">
            {FINDING_SEVERITY_LABEL[f.severity as "high" | "low"] ?? f.severity}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FindingsCard({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <Card>
      <CardBody className="flex flex-col gap-1.5">
        <span className="t-label text-ink-3">Findings</span>
        <FindingRows findings={findings} />
      </CardBody>
    </Card>
  );
}
