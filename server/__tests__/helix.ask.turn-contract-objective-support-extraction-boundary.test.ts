import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractObjectiveSupport } from "../services/helix-ask/contracts/turn-contract-objective-support";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/contracts/turn-contract-objective-support.ts",
);
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract objective-support extraction boundary", () => {
  it("keeps objective-support mapping out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-support");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnContractObjectiveSupport\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractObjectiveSupport\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves objective support matching against normalized covered slots", () => {
    expect(
      buildHelixAskTurnContractObjectiveSupport({
        contract: {
          objectives: [
            { label: "Mechanism", required_slots: ["Mechanism", "Repo Mapping"] },
            { label: "Risks", required_slots: ["Risk Register"] },
            { label: "Empty", required_slots: [] },
          ],
        },
        coveredSlots: ["mechanism", "repo mapping", "other"],
      }),
    ).toEqual([
      { objective: "Mechanism", supported: true, matched_slots: ["mechanism", "repo-mapping"] },
      { objective: "Risks", supported: false, matched_slots: [] },
      { objective: "Empty", supported: false, matched_slots: [] },
    ]);
  });
});
