import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/observation-decision.ts");

describe("Helix Ask observation decision extraction boundary", () => {
  it("keeps observation decision implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/observation-decision");
    expect(routeSource).toMatch(/const\s+buildAskTurnObservationDecision\s*=\s*createAskTurnObservationDecisionBuilder\(\{/);
    expect(routeSource).not.toMatch(/const\s+capabilityIdFromAskTurnStep\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnObservationDecision\s*=\s*\(args:\s*\{/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnObservationDecisionBuilder\s*=/);
    expect(serviceSource).toContain("all_required_artifacts_satisfied");
    expect(serviceSource).toContain("capabilityIdFromAskTurnStep");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
