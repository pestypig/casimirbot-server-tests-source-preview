import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractQueryHints } from "../services/helix-ask/contracts/turn-contract-query-hints";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-query-hints.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract query-hints extraction boundary", () => {
  it("keeps turn-contract query-hint assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-query-hints");
    expect(`${routeSource}\n${builderSource}`).toContain("buildHelixAskTurnContractQueryHints({");
    expect(routeSource).not.toContain("const queryHints = mergeHelixAskQueries(\n    researchContract?.required_repo_inputs.slice(0, 4) ?? [],");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractQueryHints\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves research, planner, objective merge order, normalization, slicing, and limit", () => {
    expect(
      buildHelixAskTurnContractQueryHints({
        researchRequiredRepoInputs: [" repo one ", "repo two", "repo three", "repo four", "repo five"],
        researchCanonicalPrecedencePaths: [
          "docs/a.md",
          "docs/b.md",
          "docs/c.md",
          "docs/d.md",
          "docs/e.md",
        ],
        plannerQueryHints: [
          " sources: **planner hint** ",
          "server/routes/agi.plan.ts quoted path should go",
          "planner hint",
        ],
        objectiveQueryHints: ["objective one", "repo two"],
        maxQueryHints: 10,
      }),
    ).toEqual([
      "repo one",
      "repo two",
      "repo three",
      "repo four",
      "docs/a.md",
      "docs/b.md",
      "docs/c.md",
      "docs/d.md",
      "planner hint",
      "quoted path should go",
    ]);

    expect(
      buildHelixAskTurnContractQueryHints({
        researchRequiredRepoInputs: null,
        researchCanonicalPrecedencePaths: null,
        plannerQueryHints: undefined,
        objectiveQueryHints: ["first", "second", "FIRST"],
        maxQueryHints: 2,
      }),
    ).toEqual(["first", "second"]);
  });
});
