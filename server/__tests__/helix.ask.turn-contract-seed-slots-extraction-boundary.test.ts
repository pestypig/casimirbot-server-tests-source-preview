import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-seed-slots.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn contract seed slot extraction boundary", () => {
  it("keeps turn contract seed slot mapping out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-seed-slots");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnContractSeedSlots\s*=\s*\(/);
    expect(routeSource).not.toContain("aliases: [objective.label].slice(0, 1)");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractSeedSlots\s*=/);
    expect(serviceSource).toContain("aliases: [objective.label].slice(0, 1)");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
