import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/scholarly-terminal-authority-refresh.ts");

describe("Helix Ask scholarly terminal authority refresh extraction boundary", () => {
  it("keeps the scholarly refresh implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/scholarly-terminal-authority-refresh");
    expect(routeSource).not.toMatch(/function\s+refreshScholarlyTerminalAuthorityAfterMaterialization\s*\(/);
    expect(routeSource).not.toMatch(/const\s+materializedScholarlyTerminalAuthorityRefreshApplies\s*=/);
    expect(routeSource).not.toMatch(/const\s+readScholarlySourceBackedFinalAnswerDraft\s*=/);
    expect(routeSource).not.toMatch(/const\s+isScholarlySourceBackedFinalAnswerDraft\s*=/);
    expect(serviceSource).toMatch(/export\s+function\s+refreshScholarlyTerminalAuthorityAfterMaterialization\s*\(/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
