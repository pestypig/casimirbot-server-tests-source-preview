import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractRiskFlags } from "../services/helix-ask/contracts/turn-contract-risk-flags";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-risk-flags.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract risk-flags extraction boundary", () => {
  it("keeps risk-flag aggregation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-risk-flags");
    expect(`${routeSource}\n${builderSource}`).toContain("maxRiskFlags: 8");
    expect(routeSource).not.toContain("risk_flags: riskFlags.slice(0, 8)");
    expect(routeSource).not.toContain('objectives.length > 1 ? "multi_objective" : null');
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractRiskFlags\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves risk flag order and enabled flags", () => {
    expect(
      buildHelixAskTurnContractRiskFlags({
        objectiveCount: 3,
        requiresRepoEvidence: true,
        promptResearchContractActive: true,
        promptResearchMissingRequiredInputsStop: true,
        explicitAnchorPathCount: 2,
        groundingMode: "open",
      }),
    ).toEqual([
      "multi_objective",
      "repo_grounding_required",
      "prompt_research_contract",
      "fail_closed_required_inputs",
      "explicit_anchor_paths",
      "open_world_allowed",
    ]);
  });

  it("preserves disabled flags", () => {
    expect(
      buildHelixAskTurnContractRiskFlags({
        objectiveCount: 1,
        requiresRepoEvidence: false,
        promptResearchContractActive: false,
        promptResearchMissingRequiredInputsStop: false,
        explicitAnchorPathCount: 0,
        groundingMode: "repo",
      }),
    ).toEqual([]);
  });

  it("preserves caller-supplied risk flag cap", () => {
    expect(
      buildHelixAskTurnContractRiskFlags({
        objectiveCount: 3,
        requiresRepoEvidence: true,
        promptResearchContractActive: true,
        promptResearchMissingRequiredInputsStop: true,
        explicitAnchorPathCount: 2,
        groundingMode: "open",
        maxRiskFlags: 3,
      }),
    ).toEqual(["multi_objective", "repo_grounding_required", "prompt_research_contract"]);
  });
});
