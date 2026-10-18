import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/goals/goal-frame-readers.ts");

describe("Helix Ask goal-frame readers extraction boundary", () => {
  it("keeps goal-frame reader helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/goals/goal-frame-readers");
    expect(routeSource).not.toMatch(/const\s+readAskTurnGoalFrameMutationTarget\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hashAskTurnGoalFrame\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnGoalFrameString\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnGoalFrameMutationTarget\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hashAskTurnGoalFrame\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnGoalFrameString\s*=/);
    expect(serviceSource).toContain("resolution !== \"missing\"");
    expect(serviceSource).toContain("sha1");
    expect(serviceSource).toContain("slice(0, 16)");
    expect(serviceSource).toContain("value.trim().length > 0");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
