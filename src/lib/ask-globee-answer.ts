import {
  ASK_GLOBEE,
  ASK_GLOBEE_TRY_PROMPTS,
  askGlobeeSelectedChip,
} from "@/lib/ask-globee";
import {
  clientHomeSnapshot,
  type ClientHomeFinding,
  type ClientHomeTitle,
} from "@/lib/dashboard-home";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";

// Findings lookup used by catalog tools (get_attention, get_blockers,
// get_submit_next). Not the user-visible send path — the operator owns that.
// Unmapped prompts return null. No invented titles, no other-org leakage.

export type AskGlobeeIntent = "attention" | "blocking" | "submit-next" | "unmapped";

export type AskGlobeeAnswer = {
  intent: AskGlobeeIntent;
  lead: string;
  follow: string | null;
  titleNames: string[];
};

export function resolveAskGlobeeIntent(prompt: string): AskGlobeeIntent {
  const selected = askGlobeeSelectedChip(prompt);
  if (selected === ASK_GLOBEE_TRY_PROMPTS[0]) return "attention";
  if (selected === ASK_GLOBEE_TRY_PROMPTS[1]) return "blocking";
  if (selected === ASK_GLOBEE_TRY_PROMPTS[2]) return "submit-next";
  return "unmapped";
}

export function orgScopedAskGlobeeFindings({
  findings,
  titles,
  orgId,
}: {
  findings: ClientHomeFinding[];
  titles: ClientHomeTitle[];
  orgId: string;
}): ClientHomeFinding[] {
  const titleIds = new Set(titles.map((title) => title.id));
  return findings.filter((finding) => finding.org_id === orgId && titleIds.has(finding.entity_id));
}

function titleNameById(titles: ClientHomeTitle[]): Map<string, ClientHomeTitle> {
  return new Map(titles.map((title) => [title.id, title]));
}

function findingLine(title: string, message: string | null | undefined): string {
  const text = message?.trim();
  return text ? `${title} — ${text}` : title;
}

function sortByTitleCreatedDesc(
  findings: ClientHomeFinding[],
  titlesById: Map<string, ClientHomeTitle>,
): ClientHomeFinding[] {
  return [...findings].sort((a, b) => {
    const aCreated = titlesById.get(a.entity_id)?.created_at ?? "";
    const bCreated = titlesById.get(b.entity_id)?.created_at ?? "";
    return aCreated < bCreated ? 1 : -1;
  });
}

function linesToAnswer(
  intent: AskGlobeeIntent,
  lines: string[],
  titleNames: string[],
  empty: string,
): AskGlobeeAnswer {
  if (lines.length === 0) {
    return { intent, lead: empty, follow: null, titleNames: [] };
  }
  return {
    intent,
    lead: lines[0] ?? empty,
    follow: lines.slice(1).join("\n") || null,
    titleNames: [...new Set(titleNames)],
  };
}

export function buildAskGlobeeAnswer({
  prompt,
  titles,
  findings,
  orgId,
  now = new Date(),
  bound = UNPAGINATED_MAX,
}: {
  prompt: string;
  titles: ClientHomeTitle[];
  findings: ClientHomeFinding[];
  orgId: string;
  now?: Date;
  bound?: number;
}): AskGlobeeAnswer | null {
  const intent = resolveAskGlobeeIntent(prompt);
  if (intent === "unmapped") return null;

  const titlesById = titleNameById(titles);
  const scoped = sortByTitleCreatedDesc(
    orgScopedAskGlobeeFindings({ findings, titles, orgId }),
    titlesById,
  );

  if (intent === "attention") {
    const titleNames: string[] = [];
    const lines = scoped.flatMap((finding) => {
      const title = titlesById.get(finding.entity_id);
      if (!title) return [];
      titleNames.push(title.title);
      return [findingLine(title.title, finding.message)];
    });
    return linesToAnswer(intent, lines, titleNames, CATALOG_HEALTH_EMPTY);
  }

  if (intent === "blocking") {
    const titleNames: string[] = [];
    const lines = scoped
      .filter((finding) => finding.severity === "high")
      .flatMap((finding) => {
        const title = titlesById.get(finding.entity_id);
        if (!title) return [];
        titleNames.push(title.title);
        return [findingLine(title.title, finding.message)];
      });
    return linesToAnswer(intent, lines, titleNames, ASK_GLOBEE.emptyBlocking);
  }

  const snapshot = clientHomeSnapshot({
    titles,
    findings,
    orgId,
    now,
    bound,
  });
  const next = snapshot.doNext[0];
  if (!next) {
    return {
      intent,
      lead: ASK_GLOBEE.emptySubmitNext,
      follow: null,
      titleNames: [],
    };
  }
  return {
    intent,
    lead: next.title,
    follow: next.reason,
    titleNames: [next.title],
  };
}
