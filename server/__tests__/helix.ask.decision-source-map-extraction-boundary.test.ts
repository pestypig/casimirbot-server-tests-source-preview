import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/decision-source-map.ts");

describe("Helix Ask decision source map extraction boundary", () => {
  it("keeps decision source map builder implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/decision-source-map");
    expect(routeSource).toMatch(/const\s+buildAskTurnDecisionSourceMap\s*=\s*createAskTurnDecisionSourceMapBuilder\(\{/);
    expect(routeSource).not.toMatch(/const\s+mapAskTurnRuntimeStepSource\s*=/);
    expect(routeSource).not.toMatch(/const\s+mapAskTurnTerminalDecisionSource\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnDecisionSourceMap\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toContain("plan_step_sources: planStepSources");
    expect(routeSource).not.toContain("continuation_sources: continuationSources");
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnDecisionSourceMapBuilder\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+mapAskTurnRuntimeStepSource\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+mapAskTurnTerminalDecisionSource\s*=/);
    expect(serviceSource).toContain("plan_step_sources: planStepSources");
    expect(serviceSource).toContain("continuation_sources: continuationSources");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
