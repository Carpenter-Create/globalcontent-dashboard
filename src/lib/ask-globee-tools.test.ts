import { describe, expect, it } from "vitest";

import { ASK_GLOBEE_TRY_PROMPTS } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import type { ClientHomeFinding, ClientHomeTitle } from "@/lib/dashboard-home";
import {
  ASK_GLOBEE_TOOL_NAMES,
  ASK_GLOBEE_TOOLS,
  executeAskGlobeeTool,
  type AskGlobeeCorpus,
} from "./ask-globee-tools";

const ORG = "org-1";
const FORBIDDEN = [
  "SECRET_OTHER_ORG",
  "ORPHAN_FINDING",
  "The Winter Line",
  "Harbor Lights",
  "Watershed",
  "E8",
];

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
  ],
  findings: [
    finding({ entity_id: "t-cut", message: "Synopsis is required.", severity: "high" }),
    finding({ entity_id: "t-light", message: "Director is recommended.", severity: "low" }),
    finding({
      org_id: "org-2",
      entity_id: "t-other",
      message: "SECRET_OTHER_ORG",
      severity: "high",
    }),
    finding({ entity_id: "missing-title", message: "ORPHAN_FINDING", severity: "high" }),
  ],
  tier: "pro",
  now: new Date("2026-08-19T12:00:00.000Z"),
};

function expectIsolated(value: unknown) {
  const payload = JSON.stringify(value);
  for (const leak of FORBIDDEN) {
    expect(payload).not.toContain(leak);
  }
  expect(payload).not.toContain("org-2");
}

describe("ASK_GLOBEE_TOOLS", () => {
  it("exposes only the read-only org-scoped catalog tools", () => {
    expect(ASK_GLOBEE_TOOLS.map((tool) => tool.name)).toEqual([...ASK_GLOBEE_TOOL_NAMES]);
    for (const tool of ASK_GLOBEE_TOOLS) {
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.input_schema.properties).toEqual({});
    }
  });
});

describe("executeAskGlobeeTool", () => {
  it("counts only this org's titles", () => {
    const result = executeAskGlobeeTool("get_catalog_summary", CORPUS);
    expect(result).toMatchObject({
      catalog: 2,
      catalogLabel: "2",
      catalogIsPartial: false,
      live: 1,
    });
    expectIsolated(result);
  });

  it("lists this org's titles and never other-org findings", () => {
    const result = executeAskGlobeeTool("list_titles", CORPUS);
    expect(result).toEqual({
      titles: [
        { title: "Harbor Cut", status: "Draft" },
        { title: "Winter Light", status: "Live" },
      ],
    });
    expectIsolated(result);
  });

  it("reuses the chip attention and blocker facts", () => {
    expect(executeAskGlobeeTool("get_attention", CORPUS)).toMatchObject({
      lead: "Harbor Cut — Synopsis is required.",
      titleNames: ["Harbor Cut", "Winter Light"],
    });
    expect(executeAskGlobeeTool("get_blockers", CORPUS)).toMatchObject({
      lead: "Harbor Cut — Synopsis is required.",
      titleNames: ["Harbor Cut"],
    });
    expect(executeAskGlobeeTool("get_submit_next", CORPUS)).toMatchObject({
      lead: "Harbor Cut",
      titleNames: ["Harbor Cut"],
    });
    expectIsolated(executeAskGlobeeTool("get_attention", CORPUS));
    expectIsolated(executeAskGlobeeTool("get_blockers", CORPUS));
    expectIsolated(executeAskGlobeeTool("get_submit_next", CORPUS));
  });

  it("returns the session tier and no commercial rates", () => {
    const result = executeAskGlobeeTool("get_agreement_tier", CORPUS);
    expect(result).toEqual({ tier: "pro" });
    expect(JSON.stringify(result)).not.toContain("797");
    expect(JSON.stringify(result)).not.toContain("$");
    expectIsolated(result);
  });

  it("tells the truth when the catalog is empty", () => {
    const empty = { ...CORPUS, titles: [], findings: [] };
    expect(executeAskGlobeeTool("get_catalog_summary", empty)).toMatchObject({
      catalog: 0,
      catalogLabel: "0",
    });
    expect(executeAskGlobeeTool("get_attention", empty)).toMatchObject({
      lead: CATALOG_HEALTH_EMPTY,
      titleNames: [],
    });
    expectIsolated(executeAskGlobeeTool("list_titles", empty));
  });

  it("ignores unknown tools and any invented org argument", () => {
    expect(executeAskGlobeeTool("delete_title", CORPUS)).toEqual({ error: "Unknown tool." });
    expect(executeAskGlobeeTool("get_catalog_summary", { ...CORPUS, orgId: "org-2" })).toMatchObject({
      catalog: 2,
    });
    expectIsolated(executeAskGlobeeTool("delete_title", CORPUS));
  });

  it("keeps chip prompts as the only findings shortcuts", () => {
    expect(ASK_GLOBEE_TRY_PROMPTS).toHaveLength(3);
  });
});
