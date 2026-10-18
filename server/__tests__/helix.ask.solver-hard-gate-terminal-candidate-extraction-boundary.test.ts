import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/solver-hard-gate-terminal-candidate.ts");

describe("Helix Ask solver hard-gate terminal candidate extraction boundary", () => {
  it("keeps applyAskTurnSolverHardGateFailure out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/solver-hard-gate-terminal-candidate");
    expect(routeSource).not.toMatch(/const\s+applyAskTurnSolverHardGateFailure\s*=/);
    expect(routeSource).not.toMatch(/function\s+applyAskTurnSolverHardGateFailure\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+applyAskTurnSolverHardGateFailure\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
