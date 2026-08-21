import { ASK_GLOBEE_TRY_PROMPTS, type AskGlobeeTier } from "@/lib/ask-globee";
import { buildAskGlobeeAnswer, type AskGlobeeAnswer } from "@/lib/ask-globee-answer";
import {
  clientHomeSnapshot,
  dashboardCatalogValue,
  dashboardTitleStatusLabel,
  type ClientHomeFinding,
  type ClientHomeTitle,
} from "@/lib/dashboard-home";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";

// Read-only tools over the org corpus already loaded for this signed-in user.
// Org id is bound at construction — never a tool argument.

export const ASK_GLOBEE_TOOL_NAMES = [
  "get_catalog_summary",
  "list_titles",
  "get_attention",
  "get_blockers",
  "get_submit_next",
  "get_agreement_tier",
] as const;

export type AskGlobeeToolName = (typeof ASK_GLOBEE_TOOL_NAMES)[number];

export type AskGlobeeCorpus = {
  orgId: string;
  titles: ClientHomeTitle[];
  findings: ClientHomeFinding[];
  tier: AskGlobeeTier | null;
  now?: Date;
  bound?: number;
};

export type AskGlobeeTool = {
  name: AskGlobeeToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, never>;
    additionalProperties: false;
  };
};

const EMPTY_INPUT = {
  type: "object" as const,
  properties: {},
  additionalProperties: false as const,
};

export const ASK_GLOBEE_TOOLS: AskGlobeeTool[] = [
  {
    name: "get_catalog_summary",
    description: "Counts titles in this client's catalog, plus live and attention totals already shown on home.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "list_titles",
    description: "Lists this client's titles and statuses. The catalog as a whole, not a search.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "get_attention",
    description: "Org-scoped catalog attention from my_findings. Same facts as the What needs attention chip.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "get_blockers",
    description: "Required (high) findings blocking a title in this catalog.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "get_submit_next",
    description: "What this client should submit next, from the home Do-next row.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "get_agreement_tier",
    description: "This client's current agreement tier already in session. No commercial rates.",
    input_schema: EMPTY_INPUT,
  },
];

export function isAskGlobeeToolName(value: string): value is AskGlobeeToolName {
  return (ASK_GLOBEE_TOOL_NAMES as readonly string[]).includes(value);
}

function chipAnswer(corpus: AskGlobeeCorpus, prompt: (typeof ASK_GLOBEE_TRY_PROMPTS)[number]): AskGlobeeAnswer {
  const answer = buildAskGlobeeAnswer({
    prompt,
    titles: corpus.titles,
    findings: corpus.findings,
    orgId: corpus.orgId,
    now: corpus.now ?? new Date(),
    bound: corpus.bound ?? UNPAGINATED_MAX,
  });
  if (!answer) {
    return { intent: "unmapped", lead: "", follow: null, titleNames: [] };
  }
  return answer;
}

export function executeAskGlobeeTool(name: string, corpus: AskGlobeeCorpus): Record<string, unknown> {
  if (!isAskGlobeeToolName(name)) {
    return { error: "Unknown tool." };
  }

  if (name === "get_catalog_summary") {
    const snapshot = clientHomeSnapshot({
      titles: corpus.titles,
      findings: corpus.findings,
      orgId: corpus.orgId,
      now: corpus.now ?? new Date(),
      bound: corpus.bound ?? UNPAGINATED_MAX,
    });
    return {
      catalog: snapshot.catalog,
      catalogLabel: dashboardCatalogValue(snapshot.catalog, snapshot.catalogIsPartial),
      catalogIsPartial: snapshot.catalogIsPartial,
      live: snapshot.live,
      needsAttention: snapshot.needsAttention,
    };
  }

  if (name === "list_titles") {
    return {
      titles: corpus.titles.map((title) => ({
        title: title.title,
        status: dashboardTitleStatusLabel(title.status) ?? title.status,
      })),
    };
  }

  if (name === "get_agreement_tier") {
    return { tier: corpus.tier };
  }

  const prompt =
    name === "get_attention"
      ? ASK_GLOBEE_TRY_PROMPTS[0]
      : name === "get_blockers"
        ? ASK_GLOBEE_TRY_PROMPTS[1]
        : ASK_GLOBEE_TRY_PROMPTS[2];
  const answer = chipAnswer(corpus, prompt);
  return {
    lead: answer.lead,
    follow: answer.follow,
    titleNames: answer.titleNames,
  };
}
