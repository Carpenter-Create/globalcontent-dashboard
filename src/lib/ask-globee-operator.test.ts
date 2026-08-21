import { describe, expect, it, vi } from "vitest";

import { ASK_GLOBEE, ASK_GLOBEE_TRY_PROMPTS } from "@/lib/ask-globee";
import type { ClientHomeFinding, ClientHomeTitle } from "@/lib/dashboard-home";
import {
  ASK_GLOBEE_MODEL_ID,
  answerAskGlobeePrompt,
  readOperatorApiKey,
  splitAskGlobeeModelText,
  type AskGlobeeModelClient,
} from "./ask-globee-operator";
import { executeAskGlobeeTool, type AskGlobeeCorpus } from "./ask-globee-tools";

const ORG = "org-1";
const TEST_KEY = "test-operator-key";
const FORBIDDEN = ["SECRET_OTHER_ORG", "ORPHAN_FINDING", "The Winter Line", "Harbor Lights", "Watershed", "E8"];

function title(partial: Partial<ClientHomeTitle> & Pick<ClientHomeTitle, "id" | "title">): ClientHomeTitle {
  return {
    status: "draft",
    created_at: "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

function finding(
  partial: Partial<ClientHomeFinding> & Pick<ClientHomeFinding, "entity_id">,
): ClientHomeFinding {
  return {
    org_id: ORG,
    message: "Synopsis is required.",
    severity: "high",
    created_at: "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

const CORPUS: AskGlobeeCorpus = {
  orgId: ORG,
  titles: [
    title({ id: "t-cut", title: "Harbor Cut", created_at: "2026-08-16T00:00:00.000Z" }),
    title({ id: "t-light", title: "Winter Light", status: "live", created_at: "2026-08-14T00:00:00.000Z" }),
    title({ id: "t-third", title: "Quiet Harbor", created_at: "2026-08-13T00:00:00.000Z" }),
    title({ id: "t-fourth", title: "North Wharf", status: "live", created_at: "2026-08-12T00:00:00.000Z" }),
  ],
  findings: [
    finding({ entity_id: "t-cut", message: "Synopsis is required.", severity: "high" }),
    finding({
      org_id: "org-2",
      entity_id: "t-other",
      message: "SECRET_OTHER_ORG",
      severity: "high",
    }),
    finding({ entity_id: "missing-title", message: "ORPHAN_FINDING", severity: "high" }),
  ],
  tier: "premium",
};

function scriptedClient(
  script: Array<{ text?: string; tools?: { id: string; name: string }[] }>,
): AskGlobeeModelClient {
  let index = 0;
  return async (round) => {
    expect(round.model).toBe(ASK_GLOBEE_MODEL_ID);
    const step = script[index] ?? { text: "" };
    index += 1;
    const content = [
      ...(step.text ? [{ type: "text" as const, text: step.text }] : []),
      ...(step.tools ?? []).map((tool) => ({
        type: "tool_use" as const,
        id: tool.id,
        name: tool.name,
        input: {},
      })),
    ];
    return {
      stop_reason: step.tools?.length ? "tool_use" : "end_turn",
      content,
    };
  };
}

describe("readOperatorApiKey", () => {
  it("fails closed on a missing or blank key", () => {
    expect(readOperatorApiKey({})).toBeNull();
    expect(readOperatorApiKey({ ANTHROPIC_API_KEY: "" })).toBeNull();
    expect(readOperatorApiKey({ ANTHROPIC_API_KEY: "   " })).toBeNull();
    expect(readOperatorApiKey({ ANTHROPIC_API_KEY: TEST_KEY })).toBe(TEST_KEY);
  });
});

describe("splitAskGlobeeModelText", () => {
  it("uses the first line as lead", () => {
    expect(splitAskGlobeeModelText("Your catalog has 4 titles.\nHarbor Cut is a draft.")).toEqual({
      lead: "Your catalog has 4 titles.",
      follow: "Harbor Cut is a draft.",
    });
  });
});

describe("answerAskGlobeePrompt", () => {
  it("keeps chip intents on the live findings path and never calls the model", async () => {
    const modelClient = vi.fn();
    const result = await answerAskGlobeePrompt({
      prompt: ASK_GLOBEE_TRY_PROMPTS[0],
      corpus: CORPUS,
      env: { ANTHROPIC_API_KEY: TEST_KEY },
      modelClient,
    });
    expect(result).toMatchObject({
      intent: "attention",
      lead: "Harbor Cut — Synopsis is required.",
    });
    expect(modelClient).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(ASK_GLOBEE.capability);
    for (const leak of FORBIDDEN) {
      expect(JSON.stringify(result)).not.toContain(leak);
    }
  });

  it("answers unmapped free text from tools instead of the capability stub", async () => {
    const modelClient = scriptedClient([
      { tools: [{ id: "toolu_1", name: "get_catalog_summary" }] },
      { text: "Your catalog has 4 titles." },
    ]);
    const result = await answerAskGlobeePrompt({
      prompt: "How many titles are in my catalog?",
      corpus: CORPUS,
      env: { ANTHROPIC_API_KEY: TEST_KEY },
      modelClient,
    });
    expect(result).toEqual({
      intent: "unmapped",
      lead: "Your catalog has 4 titles.",
      follow: null,
      titleNames: [],
    });
    expect(JSON.stringify(result)).not.toBe(JSON.stringify({
      intent: "unmapped",
      lead: ASK_GLOBEE.capability,
      follow: null,
      titleNames: [],
    }));
    expect(JSON.stringify(result)).not.toContain(ASK_GLOBEE.capability);
    for (const leak of FORBIDDEN) {
      expect(JSON.stringify(result)).not.toContain(leak);
    }
  });

  it("never puts another org's titles or findings in tool results used by the model", async () => {
    const seen: string[] = [];
    const modelClient: AskGlobeeModelClient = async (round) => {
      seen.push(JSON.stringify(round.messages));
      const last = round.messages[round.messages.length - 1];
      if (typeof last?.content === "string") {
        return {
          stop_reason: "tool_use",
          content: ASK_GLOBEE_TOOL_NAMES_AS_USES(),
        };
      }
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Harbor Cut needs a synopsis." }],
      };
    };
    const result = await answerAskGlobeePrompt({
      prompt: "What title?",
      corpus: CORPUS,
      env: { ANTHROPIC_API_KEY: TEST_KEY },
      modelClient,
    });
    expect("lead" in result && result.lead).toBe("Harbor Cut needs a synopsis.");
    const payload = `${seen.join("\n")}\n${JSON.stringify(result)}`;
    for (const leak of FORBIDDEN) {
      expect(payload).not.toContain(leak);
    }
  });

  it("fails closed when the operator key is missing", async () => {
    const modelClient = vi.fn();
    await expect(
      answerAskGlobeePrompt({
        prompt: "Would you help guide me?",
        corpus: CORPUS,
        env: {},
        modelClient,
      }),
    ).resolves.toEqual({ error: ASK_GLOBEE.unavailable });
    expect(modelClient).not.toHaveBeenCalled();
  });

  it("fails closed when the model request throws", async () => {
    await expect(
      answerAskGlobeePrompt({
        prompt: "Would you help guide me?",
        corpus: CORPUS,
        env: { ANTHROPIC_API_KEY: TEST_KEY },
        modelClient: async () => {
          throw new Error("network");
        },
      }),
    ).resolves.toEqual({ error: ASK_GLOBEE.unavailable });
  });
});

function ASK_GLOBEE_TOOL_NAMES_AS_USES() {
  return [
    { type: "tool_use" as const, id: "toolu_sum", name: "get_catalog_summary", input: {} },
    { type: "tool_use" as const, id: "toolu_list", name: "list_titles", input: {} },
    { type: "tool_use" as const, id: "toolu_att", name: "get_attention", input: {} },
    { type: "tool_use" as const, id: "toolu_block", name: "get_blockers", input: {} },
    { type: "tool_use" as const, id: "toolu_next", name: "get_submit_next", input: {} },
    { type: "tool_use" as const, id: "toolu_tier", name: "get_agreement_tier", input: {} },
  ];
}

describe("tool results used by the operator", () => {
  it("stay inside the active org when every tool runs", () => {
    const results = [
      executeAskGlobeeTool("get_catalog_summary", CORPUS),
      executeAskGlobeeTool("list_titles", CORPUS),
      executeAskGlobeeTool("get_attention", CORPUS),
      executeAskGlobeeTool("get_blockers", CORPUS),
      executeAskGlobeeTool("get_submit_next", CORPUS),
      executeAskGlobeeTool("get_agreement_tier", CORPUS),
    ];
    const payload = JSON.stringify(results);
    expect(payload).toContain("Harbor Cut");
    expect(payload).toContain("4");
    for (const leak of FORBIDDEN) {
      expect(payload).not.toContain(leak);
    }
  });
});
