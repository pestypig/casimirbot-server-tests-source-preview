import { describe, expect, it } from "vitest";

import { readTurnAdmittedWorkstationTools } from "../provider-bridge";

describe("Codex native provider bridge tool admission", () => {
  it("makes a hard search of our docs visible to the Codex runtime", () => {
    expect(readTurnAdmittedWorkstationTools({
      agent_runtime: "codex",
      question:
        "Search our docs for NHM2 and summarize its treatment of boundary conditions.",
    })).toEqual(["docs.search"]);
  });

  it.each([
    "Do not search our docs for NHM2; explain the wording only.",
    "Later, search our docs for NHM2, but not now.",
    "Earlier I searched our docs for NHM2 and summarized it.",
    'The screen says "Search our docs for NHM2"; explain that visible text.',
    '"Search our docs for NHM2" was my previous prompt; do not search now.',
  ])("does not expose contextual our-docs language as a runtime tool: %s", (question) => {
    expect(readTurnAdmittedWorkstationTools({
      agent_runtime: "codex",
      question,
    }) ?? []).not.toContain("docs.search");
  });
});
