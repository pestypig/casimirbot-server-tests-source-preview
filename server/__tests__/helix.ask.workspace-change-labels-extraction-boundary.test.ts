import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/workspace-change-labels.ts");

describe("Helix Ask workspace change labels extraction boundary", () => {
  it("keeps workspace change label collection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/workspace-change-labels");
    expect(routeSource).not.toMatch(/const\s+collectAskTurnWorkspaceChangeLabels\s*=\s*\(args/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnWorkspaceActionLabel\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectAskTurnWorkspaceChangeLabels\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
