import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractPlannerMetadata } from "../services/helix-ask/contracts/turn-contract-planner-metadata";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-planner-metadata.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract planner-metadata extraction boundary", () => {
  it("keeps planner metadata packaging out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-planner-metadata");
    expect(`${routeSource}\n${builderSource}`).toContain("planner: buildHelixAskTurnContractPlannerMetadata({");
    expect(routeSource).not.toContain("planner: {\n      mode: args.plannerMode,\n      valid: args.plannerValid,\n      source: args.plannerSource,\n    },");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractPlannerMetadata\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves planner mode, valid flag, and source string", () => {
    expect(
      buildHelixAskTurnContractPlannerMetadata({
        mode: "llm",
        valid: true,
        source: "objective_planner",
      }),
    ).toEqual({
      mode: "llm",
      valid: true,
      source: "objective_planner",
    });

    expect(
      buildHelixAskTurnContractPlannerMetadata({
        mode: "deterministic",
        valid: false,
        source: "",
      }),
    ).toEqual({
      mode: "deterministic",
      valid: false,
      source: "",
    });
  });
});
