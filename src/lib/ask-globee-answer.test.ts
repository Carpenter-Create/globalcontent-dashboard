import { describe, expect, it } from "vitest";

import { ASK_GLOBEE, ASK_GLOBEE_TRY_PROMPTS } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import type { ClientHomeFinding, ClientHomeTitle } from "@/lib/dashboard-home";
import {
  buildAskGlobeeAnswer,
  orgScopedAskGlobeeFindings,
  resolveAskGlobeeIntent,
} from "./ask-globee-answer";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const ORG = "org-1";

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

const ORG_TITLES = [
  title({ id: "t-cut", title: "Harbor Cut", created_at: "2026-08-16T00:00:00.000Z" }),
  title({ id: "t-light", title: "Winter Light", status: "live", created_at: "2026-08-14T00:00:00.000Z" }),
];

const MIXED_FINDINGS = [
  finding({ entity_id: "t-cut", message: "Synopsis is required.", severity: "high" }),
  finding({ entity_id: "t-light", message: "Director is recommended.", severity: "low" }),
  finding({
    org_id: "org-2",
    entity_id: "t-other",
    message: "SECRET_OTHER_ORG",
    severity: "high",
  }),
  finding({ entity_id: "missing-title", message: "ORPHAN_FINDING", severity: "high" }),
];

function answer(prompt: string, extras?: { titles?: ClientHomeTitle[]; findings?: ClientHomeFinding[] }) {
  const result = buildAskGlobeeAnswer({
    prompt,
    titles: extras?.titles ?? ORG_TITLES,
    findings: extras?.findings ?? MIXED_FINDINGS,
    orgId: ORG,
    now: NOW,
    bound: UNPAGINATED_MAX,
  });
  if (!result) throw new Error(`expected a mapped Ask Globee answer for ${prompt}`);
  return result;
}

function expectOrgTitlesOnly(
  result: NonNullable<ReturnType<typeof buildAskGlobeeAnswer>>,
  titles: ClientHomeTitle[] = ORG_TITLES,
) {
  const allowed = new Set(titles.map((row) => row.title));
  for (const name of result.titleNames) {
    expect(allowed.has(name)).toBe(true);
  }
  expect(JSON.stringify(result)).not.toContain("SECRET_OTHER_ORG");
  expect(JSON.stringify(result)).not.toContain("ORPHAN_FINDING");
  expect(JSON.stringify(result)).not.toContain("The Winter Line");
  expect(JSON.stringify(result)).not.toContain("Harbor Lights");
  expect(JSON.stringify(result)).not.toMatch(/Artwork missing|Metadata incomplete/i);
}

describe("resolveAskGlobeeIntent", () => {
  it("maps chip labels and case-trimmed equals to the same intent", () => {
    expect(resolveAskGlobeeIntent(ASK_GLOBEE_TRY_PROMPTS[0])).toBe("attention");
    expect(resolveAskGlobeeIntent("  what needs attention  ")).toBe("attention");
    expect(resolveAskGlobeeIntent(ASK_GLOBEE_TRY_PROMPTS[1])).toBe("blocking");
    expect(resolveAskGlobeeIntent("What is blocking a title")).toBe("blocking");
    expect(resolveAskGlobeeIntent(ASK_GLOBEE_TRY_PROMPTS[2])).toBe("submit-next");
    expect(resolveAskGlobeeIntent("WHAT SHOULD I SUBMIT NEXT")).toBe("submit-next");
  });

  it("does not treat Winter Line fixture copy as a mapped intent", () => {
    expect(resolveAskGlobeeIntent(ASK_GLOBEE.userPrompt)).toBe("unmapped");
    expect(resolveAskGlobeeIntent(ASK_GLOBEE.threadTitle)).toBe("unmapped");
    expect(resolveAskGlobeeIntent("What's blocking The Winter Line")).toBe("unmapped");
  });
});

describe("orgScopedAskGlobeeFindings", () => {
  it("keeps only the active org and titles that exist in that org set", () => {
    const scoped = orgScopedAskGlobeeFindings({
      findings: MIXED_FINDINGS,
      titles: ORG_TITLES,
      orgId: ORG,
    });
    expect(scoped.map((row) => row.entity_id)).toEqual(["t-cut", "t-light"]);
    expect(scoped.some((row) => row.message === "SECRET_OTHER_ORG")).toBe(false);
    expect(scoped.some((row) => row.message === "ORPHAN_FINDING")).toBe(false);
  });
});

describe("buildAskGlobeeAnswer", () => {
  it("answers attention with real org title names and finding messages", () => {
    const result = answer("What needs attention");
    expect(result.intent).toBe("attention");
    expect(result.lead).toBe("Harbor Cut — Synopsis is required.");
    expect(result.follow).toBe("Winter Light — Director is recommended.");
    expect(result.titleNames).toEqual(["Harbor Cut", "Winter Light"]);
    expectOrgTitlesOnly(result);
  });

  it("answers blockers with required/high findings only", () => {
    const result = answer("What is blocking a title");
    expect(result.intent).toBe("blocking");
    expect(result.lead).toBe("Harbor Cut — Synopsis is required.");
    expect(result.follow).toBeNull();
    expect(result.titleNames).toEqual(["Harbor Cut"]);
    expect(result.lead).not.toContain("Director is recommended.");
    expectOrgTitlesOnly(result);
  });

  it("answers submit-next from the home Do-next row and does not invent a title", () => {
    const result = answer("What should I submit next");
    expect(result.intent).toBe("submit-next");
    expect(result.lead).toBe("Harbor Cut");
    expect(result.follow).toBe("Synopsis is required.");
    expect(result.titleNames).toEqual(["Harbor Cut"]);
    expectOrgTitlesOnly(result);
  });

  it("prefers a leftover draft when findings are empty", () => {
    const titles = [title({ id: "draft-1", title: "Quiet Harbor", status: "draft" })];
    const result = answer("What should I submit next", { titles, findings: [] });
    expect(result.lead).toBe("Quiet Harbor");
    expect(result.follow).toBeNull();
    expect(result.titleNames).toEqual(["Quiet Harbor"]);
    expectOrgTitlesOnly(result, titles);
  });

  it("tells the truth when the catalog is empty", () => {
    const empty = { titles: [], findings: [] };
    expect(answer("What needs attention", empty)).toEqual({
      intent: "attention",
      lead: CATALOG_HEALTH_EMPTY,
      follow: null,
      titleNames: [],
    });
    expect(answer("What is blocking a title", empty)).toEqual({
      intent: "blocking",
      lead: ASK_GLOBEE.emptyBlocking,
      follow: null,
      titleNames: [],
    });
    expect(answer("What should I submit next", empty)).toEqual({
      intent: "submit-next",
      lead: ASK_GLOBEE.emptySubmitNext,
      follow: null,
      titleNames: [],
    });
  });

  it("does not answer unmapped free text — the operator owns that path", () => {
    const result = buildAskGlobeeAnswer({
      prompt: "How many titles are in my catalog?",
      titles: ORG_TITLES,
      findings: MIXED_FINDINGS,
      orgId: ORG,
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(result).toBeNull();
    expect(ASK_GLOBEE.capability).toBe(
      "I can answer catalog attention, blockers, and what to submit next.",
    );
  });

  it("never emits another org's title even when my_findings includes it", () => {
    const result = answer("What needs attention");
    expect(result.titleNames.every((name) => ORG_TITLES.some((row) => row.title === name))).toBe(
      true,
    );
    expectOrgTitlesOnly(result);
  });
});
