import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractRequiredSlots } from "../services/helix-ask/contracts/turn-contract-slots";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-slots.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract slots extraction boundary", () => {
  it("keeps required-slot aggregation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-slots");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnContractRequiredSlots\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractRequiredSlots\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves family defaults, objective slots, explicit slots, dedupe, and cap order", () => {
    expect(
      buildHelixAskTurnContractRequiredSlots({
        family: "mechanism_process",
        objectives: [
          {
            required_slots: ["Mechanism", " custom slot ", "Repo Mapping"],
          },
        ],
        requiredSlots: ["Failure Modes", "extra slot"],
        maxRequiredSlots: 5,
      }),
    ).toEqual(["mechanism", "repo-mapping", "failure-modes", "custom-slot", "extra-slot"]);
  });
});
