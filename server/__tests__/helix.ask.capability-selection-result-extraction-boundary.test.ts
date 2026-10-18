import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/capability-selection-result.ts");

describe("Helix Ask capability selection result extraction boundary", () => {
  it("keeps capability selection result implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/capability-selection-result");
    expect(routeSource).toMatch(/const\s+buildAskTurnCapabilitySelectionResult\s*=\s*createAskTurnCapabilitySelectionResultBuilder\(\{/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnCapabilitySelectionResult\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toContain("No confident goal-frame capability selected.");
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnCapabilitySelectionResultBuilder\s*=/);
    expect(serviceSource).toContain("No confident goal-frame capability selected.");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
