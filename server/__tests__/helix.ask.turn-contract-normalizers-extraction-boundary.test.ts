import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectHelixAskTurnContractDefinitionRelationRepoMismatch,
  normalizeHelixAskTurnContractFamily,
  normalizeHelixAskTurnContractGroundingMode,
  selectHelixAskTurnContractFamily,
  selectHelixAskTurnContractGroundingMode,
  selectHelixAskTurnContractPlannerFamily,
  selectHelixAskTurnContractRequestedGroundingMode,
} from "../services/helix-ask/contracts/turn-contract-normalizers";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-normalizers.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract normalizers extraction boundary", () => {
  it("keeps turn-contract normalizers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-normalizers");
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskTurnContractFamily\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskTurnContractGroundingMode\s*=\s*\(/);
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractPlannerFamily(args.plannerPass?.output_family)");
    expect(`${routeSource}\n${builderSource}`).toContain("detectHelixAskTurnContractDefinitionRelationRepoMismatch({");
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractFamily({");
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractRequestedGroundingMode(");
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractGroundingMode({");
    expect(routeSource).not.toContain("const defaultGroundingMode: HelixAskTurnContractGroundingMode =");
    expect(routeSource).not.toContain("const family = plannerDefinitionRelationRepoMismatch");
    expect(routeSource).not.toContain('plannerFamily === "definition_overview" &&');
    expect(routeSource).not.toContain("? normalizeHelixAskTurnContractFamily(args.plannerPass.output_family)");
    expect(routeSource).not.toContain("? normalizeHelixAskTurnContractGroundingMode(args.plannerPass.grounding_mode)");
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskTurnContractFamily\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskTurnContractGroundingMode\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractPlannerFamily\s*=/);
    expect(serviceSource).toMatch(
      /export\s+const\s+detectHelixAskTurnContractDefinitionRelationRepoMismatch\s*=/,
    );
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractFamily\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractRequestedGroundingMode\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractGroundingMode\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves accepted family and grounding mode literals", () => {
    expect(normalizeHelixAskTurnContractFamily(" Mechanism_Process ")).toBe("mechanism_process");
    expect(normalizeHelixAskTurnContractFamily("unknown")).toBeNull();
    expect(normalizeHelixAskTurnContractGroundingMode("HYBRID")).toBe("hybrid");
    expect(normalizeHelixAskTurnContractGroundingMode("local")).toBeNull();
  });

  it("preserves planner family and requested grounding selectors", () => {
    expect(selectHelixAskTurnContractPlannerFamily("Recommendation_Decision")).toBe(
      "recommendation_decision",
    );
    expect(selectHelixAskTurnContractPlannerFamily(undefined)).toBeNull();
    expect(selectHelixAskTurnContractPlannerFamily("unknown")).toBeNull();
    expect(selectHelixAskTurnContractRequestedGroundingMode("Repo")).toBe("repo");
    expect(selectHelixAskTurnContractRequestedGroundingMode(undefined)).toBeNull();
    expect(selectHelixAskTurnContractRequestedGroundingMode("local")).toBeNull();
  });

  it("preserves final family selector precedence", () => {
    expect(
      selectHelixAskTurnContractFamily({
        plannerFamily: "definition_overview",
        fallbackFamily: "mechanism_process",
        definitionRelationRepoMismatch: true,
      }),
    ).toBe("mechanism_process");
    expect(
      selectHelixAskTurnContractFamily({
        plannerFamily: "recommendation_decision",
        fallbackFamily: "general_overview",
        definitionRelationRepoMismatch: false,
      }),
    ).toBe("recommendation_decision");
    expect(
      selectHelixAskTurnContractFamily({
        plannerFamily: null,
        fallbackFamily: "general_overview",
        definitionRelationRepoMismatch: false,
      }),
    ).toBe("general_overview");
  });

  it("preserves definition relation repo mismatch detection", () => {
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "definition_overview",
        fallbackFamily: "mechanism_process",
        definitionFocus: true,
        relationQuery: true,
        definitionRepoAnchorCue: true,
      }),
    ).toBe(true);
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "recommendation_decision",
        fallbackFamily: "mechanism_process",
        definitionFocus: true,
        relationQuery: true,
        definitionRepoAnchorCue: true,
      }),
    ).toBe(false);
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "definition_overview",
        fallbackFamily: "general_overview",
        definitionFocus: true,
        relationQuery: true,
        definitionRepoAnchorCue: true,
      }),
    ).toBe(false);
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "definition_overview",
        fallbackFamily: "mechanism_process",
        definitionFocus: false,
        relationQuery: true,
        definitionRepoAnchorCue: true,
      }),
    ).toBe(false);
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "definition_overview",
        fallbackFamily: "mechanism_process",
        definitionFocus: true,
        relationQuery: false,
        definitionRepoAnchorCue: true,
      }),
    ).toBe(false);
    expect(
      detectHelixAskTurnContractDefinitionRelationRepoMismatch({
        plannerFamily: "definition_overview",
        fallbackFamily: "mechanism_process",
        definitionFocus: true,
        relationQuery: true,
        definitionRepoAnchorCue: false,
      }),
    ).toBe(false);
  });

  it("preserves final grounding-mode precedence", () => {
    expect(
      selectHelixAskTurnContractGroundingMode({
        requiresRepoEvidence: true,
        intentDomain: "general",
        requestedGroundingMode: "open",
      }),
    ).toBe("repo");
    expect(
      selectHelixAskTurnContractGroundingMode({
        requiresRepoEvidence: false,
        intentDomain: "repo",
        requestedGroundingMode: "hybrid",
      }),
    ).toBe("repo");
    expect(
      selectHelixAskTurnContractGroundingMode({
        requiresRepoEvidence: false,
        intentDomain: "hybrid",
        requestedGroundingMode: null,
      }),
    ).toBe("hybrid");
    expect(
      selectHelixAskTurnContractGroundingMode({
        requiresRepoEvidence: false,
        intentDomain: "general",
        requestedGroundingMode: "repo",
      }),
    ).toBe("repo");
    expect(
      selectHelixAskTurnContractGroundingMode({
        requiresRepoEvidence: false,
        intentDomain: "falsifiable",
        requestedGroundingMode: null,
      }),
    ).toBe("open");
  });
});
