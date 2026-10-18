import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractConstraints } from "../services/helix-ask/contracts/turn-contract-constraints";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-constraints.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract constraints extraction boundary", () => {
  it("keeps constraints field assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-constraints");
    expect(`${routeSource}\n${builderSource}`).toContain("constraints: buildHelixAskTurnContractConstraints({");
    expect(routeSource).not.toContain("requires_citations: args.requiresRepoEvidence || groundingMode !== \"open\"");
    expect(routeSource).not.toContain("allow_open_world_bypass: !args.requiresRepoEvidence && groundingMode !== \"repo\"");
    expect(routeSource).not.toContain("clarify_allowed: family !== \"equation_formalism\" || specificity !== \"specific\"");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractConstraints\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves citation, open-world bypass, clarify, and tone policy rules", () => {
    expect(
      buildHelixAskTurnContractConstraints({
        requiresRepoEvidence: true,
        groundingMode: "open",
        family: "general_overview",
        specificity: "broad",
      }),
    ).toEqual({
      requires_repo_evidence: true,
      requires_citations: true,
      allow_open_world_bypass: false,
      clarify_allowed: true,
      tone_policy: "optimistic-but-honest",
    });

    expect(
      buildHelixAskTurnContractConstraints({
        requiresRepoEvidence: false,
        groundingMode: "repo",
        family: "general_overview",
        specificity: "mid",
      }),
    ).toMatchObject({
      requires_repo_evidence: false,
      requires_citations: true,
      allow_open_world_bypass: false,
      clarify_allowed: true,
    });

    expect(
      buildHelixAskTurnContractConstraints({
        requiresRepoEvidence: false,
        groundingMode: "hybrid",
        family: "general_overview",
        specificity: "specific",
      }),
    ).toMatchObject({
      requires_citations: true,
      allow_open_world_bypass: true,
      clarify_allowed: true,
    });

    expect(
      buildHelixAskTurnContractConstraints({
        requiresRepoEvidence: false,
        groundingMode: "open",
        family: "equation_formalism",
        specificity: "specific",
      }),
    ).toMatchObject({
      requires_citations: false,
      allow_open_world_bypass: true,
      clarify_allowed: false,
    });
  });
});
